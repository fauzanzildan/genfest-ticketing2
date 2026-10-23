require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const FRONTEND_URL = String(process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/+$/,"");
const EVENT_NAME = process.env.EVENT_NAME || "GENFEST IKMAB-K 2026 - FUN RUN";
const TICKET_PRICE = Number(process.env.TICKET_PRICE || 130000);
const TICKET_LIMIT = Number(process.env.TICKET_LIMIT || 200);
if(!process.env.DATABASE_URL) throw new Error("DATABASE_URL belum diatur.");
if(!process.env.XENDIT_SECRET_KEY) throw new Error("XENDIT_SECRET_KEY belum diatur.");
if(!process.env.XENDIT_CALLBACK_TOKEN) throw new Error("XENDIT_CALLBACK_TOKEN belum diatur.");
if(!process.env.ADMIN_KEY||process.env.ADMIN_KEY.length<32) throw new Error("ADMIN_KEY wajib berisi minimal 32 karakter.");

const pool = new Pool({
  connectionString:process.env.DATABASE_URL,
  ssl:String(process.env.PG_SSL).toLowerCase()==="true"?{rejectUnauthorized:false}:false,
  max:10,
  idleTimeoutMillis:30000,
  connectionTimeoutMillis:10000
});
app.use(cors({origin:FRONTEND_URL,methods:["GET","POST","OPTIONS"],allowedHeaders:["Content-Type","Authorization"]}));
app.use(express.json({limit:"100kb"}));

function makeId(prefix){return `${prefix}-${Date.now()}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;}
function safeEqual(a,b){const x=Buffer.from(String(a||"")),y=Buffer.from(String(b||""));return x.length===y.length&&crypto.timingSafeEqual(x,y);}
function requireAdmin(req,res,next){
  const supplied=String(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
  if(!safeEqual(supplied,process.env.ADMIN_KEY))return res.status(401).json({error:"Admin Key tidak valid."});
  next();
}
function normalizePhone(v){return String(v||"").trim().replace(/[^\d+]/g,"");}
function makeTicketCodes(quantity){return Array.from({length:quantity},()=>makeId("TKT"));}
app.get("/api/health",(_req,res)=>res.json({ok:true}));
app.get("/api/config",async(_req,res)=>{
  try{
    const r=await pool.query("SELECT COALESCE(SUM(quantity) FILTER (WHERE payment_status='paid'),0)::int AS sold FROM public.orders");
    res.json({eventName:EVENT_NAME,ticketPrice:TICKET_PRICE,ticketLimit:TICKET_LIMIT,sold:r.rows[0].sold,eventDate:process.env.EVENT_DATE||"15 November 2026",eventLocation:process.env.EVENT_LOCATION||"Area Kampus 2 UIN K.H. Abdurrahman Wahid Pekalongan",paymentProvider:"Xendit"});
  }catch(err){console.error(err);res.status(500).json({error:"Gagal memuat konfigurasi acara."});}
});

app.post("/api/create-order",async(req,res)=>{
  const name=String(req.body.name||"").trim(),email=String(req.body.email||"").trim().toLowerCase(),phone=normalizePhone(req.body.phone),quantity=Number(req.body.quantity);
  if(name.length<2||name.length>120)return res.status(400).json({error:"Nama harus berisi 2–120 karakter."});
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>180)return res.status(400).json({error:"Format email tidak valid."});
  if(phone.length<9||phone.length>20)return res.status(400).json({error:"Nomor WhatsApp tidak valid."});
  if(!Number.isInteger(quantity)||quantity<1||quantity>5)return res.status(400).json({error:"Jumlah tiket harus 1–5 per pesanan."});
  if(!Number.isSafeInteger(TICKET_PRICE)||TICKET_PRICE<1)return res.status(500).json({error:"Harga tiket belum dikonfigurasi dengan benar."});
  const client=await pool.connect();let order;
  try{
    await client.query("BEGIN");
    // Serializes order creation for a small-event capacity check. A dedicated inventory
    // table / atomic reservation is recommended if traffic grows.
    await client.query("LOCK TABLE public.orders IN SHARE ROW EXCLUSIVE MODE");
    const capacity=await client.query(`
      SELECT
        COALESCE(SUM(quantity) FILTER (WHERE payment_status='paid'),0)::int AS sold,
        COALESCE(SUM(quantity) FILTER (WHERE payment_status='pending' AND created_at>NOW()-INTERVAL '30 minutes'),0)::int AS reserved
      FROM public.orders`);
    const {sold,reserved}=capacity.rows[0];
    if(sold+reserved+quantity>TICKET_LIMIT){await client.query("ROLLBACK");return res.status(409).json({error:"Kuota tiket tidak mencukupi. Kurangi jumlah tiket atau hubungi panitia."});}
    const orderId=makeId("GENFEST"),total=TICKET_PRICE*quantity;
    const result=await client.query(`
      INSERT INTO public.orders(order_id,buyer_name,email,phone,quantity,unit_price,total_amount,payment_status)
      VALUES($1,$2,$3,$4,$5,$6,$7,'pending')
      RETURNING order_id,buyer_name,email,phone,quantity,unit_price,total_amount`,
      [orderId,name,email,phone,quantity,TICKET_PRICE,total]);
    order=result.rows[0];await client.query("COMMIT");
  }catch(err){await client.query("ROLLBACK").catch(()=>{});console.error(err);return res.status(500).json({error:"Gagal membuat pesanan."});}
  finally{client.release();}
  try{
    const response=await fetch("https://api.xendit.co/v2/invoices",{
      method:"POST",
      headers:{
        "Authorization":`Basic ${Buffer.from(`${process.env.XENDIT_SECRET_KEY}:`).toString("base64")}`,
        "Content-Type":"application/json",
        "api-version":"2022-10-31"
      },
      body:JSON.stringify({
        external_id:order.order_id,
        amount:Number(order.total_amount),
        currency:"IDR",
        payer_email:order.email,
        description:`Tiket GENFEST IKMAB-K 2026 (${order.quantity} tiket)`,
        invoice_duration:1800,
        success_redirect_url:`${FRONTEND_URL}/?order_id=${encodeURIComponent(order.order_id)}&payment=success`,
        failure_redirect_url:`${FRONTEND_URL}/?order_id=${encodeURIComponent(order.order_id)}&payment=failed`,
        customer:{given_names:order.buyer_name,email:order.email,mobile_number:order.phone},
        items:[{name:"Tiket GENFEST Fun Run",quantity:Number(order.quantity),price:Number(order.unit_price),category:"Event Ticket"}],
        metadata:{event:"GENFEST IKMAB-K 2026",order_id:order.order_id}
      })
    });
    const invoice=await response.json().catch(()=>({}));
    if(!response.ok||!invoice.invoice_url)throw new Error(invoice.message||invoice.error_code||`Xendit API error (${response.status})`);
    await pool.query("UPDATE public.orders SET transaction_status=$1 WHERE order_id=$2",[String(invoice.status||"PENDING"),order.order_id]);
    res.status(201).json({orderId:order.order_id,totalAmount:Number(order.total_amount),invoiceUrl:invoice.invoice_url});
  }catch(err){
    console.error("Xendit create invoice:",err.message||err);
    await pool.query("UPDATE public.orders SET payment_status='failed',transaction_status='invoice_creation_failed' WHERE order_id=$1",[order.order_id]).catch(console.error);
    res.status(502).json({error:"Xendit belum dapat membuat halaman pembayaran. Periksa API key dan status akun, lalu coba lagi."});
  }
});

// Xendit invoice webhook. Validate the callback token and amount before issuing tickets.
app.post("/api/payment-notification",async(req,res)=>{
  try{
    const callbackToken=String(req.get("x-callback-token")||"");
    if(!safeEqual(callbackToken,process.env.XENDIT_CALLBACK_TOKEN))return res.status(401).json({error:"Callback token tidak valid."});
    const payload=req.body?.data || req.body || {};
    const orderId=String(payload.external_id||payload.externalId||"");
    const status=String(payload.status||"").toUpperCase();
    if(!orderId)return res.status(400).json({error:"external_id tidak ditemukan."});
    let paymentStatus="pending";
    if(status==="PAID"||status==="SETTLED")paymentStatus="paid";
    else if(["EXPIRED","FAILED","CANCELLED"].includes(status))paymentStatus="failed";
    const client=await pool.connect();
    try{
      await client.query("BEGIN");
      const found=await client.query("SELECT order_id,total_amount,payment_status,quantity FROM public.orders WHERE order_id=$1 FOR UPDATE",[orderId]);
      if(!found.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Pesanan tidak ditemukan."});}
      const row=found.rows[0];
      const paidAmount=Number(payload.paid_amount ?? payload.paidAmount ?? payload.amount);
      if(paymentStatus==="paid"&&(!Number.isFinite(paidAmount)||paidAmount!==Number(row.total_amount))){
        await client.query("ROLLBACK");
        console.error(`Xendit amount mismatch for ${orderId}: expected ${row.total_amount}, received ${paidAmount}`);
        return res.status(400).json({error:"Nominal pembayaran tidak cocok."});
      }
      // Never downgrade an already paid order because of a late/duplicate webhook.
      if(row.payment_status!=="paid"||paymentStatus==="paid"){
        await client.query(`UPDATE public.orders SET payment_status=$1,transaction_status=$2,payment_type=$3,
          paid_at=CASE WHEN $1='paid' THEN COALESCE(paid_at,NOW()) ELSE paid_at END WHERE order_id=$4`,
          [paymentStatus,status,String(payload.payment_method||payload.payment_channel||"").slice(0,50),row.order_id]);
      }
      if(paymentStatus==="paid"){
        const existing=await client.query("SELECT COUNT(*)::int AS n FROM public.tickets WHERE order_id=$1",[row.order_id]);
        const missing=Number(row.quantity)-existing.rows[0].n;
        if(missing>0){
          const codes=makeTicketCodes(missing);
          for(const code of codes)await client.query("INSERT INTO public.tickets(ticket_code,order_id) VALUES($1,$2) ON CONFLICT(ticket_code) DO NOTHING",[code,row.order_id]);
        }
      }
      await client.query("COMMIT");
    }catch(err){await client.query("ROLLBACK").catch(()=>{});throw err;}finally{client.release();}
    res.status(200).json({received:true});
  }catch(err){console.error("Xendit notification error:",err.message||err);res.status(500).json({error:"Gagal memproses notifikasi."});}
});

app.get("/api/order/:orderId",async(req,res)=>{
  try{
    const result=await pool.query(`SELECT order_id,buyer_name,quantity,unit_price,total_amount,payment_status,transaction_status,payment_type,created_at,paid_at
      FROM public.orders WHERE order_id=$1`,[req.params.orderId]);
    if(!result.rowCount)return res.status(404).json({error:"Pesanan tidak ditemukan."});
    const row=result.rows[0];let tickets=[];
    if(row.payment_status==="paid"){
      const tr=await pool.query("SELECT ticket_code,checked_in_at FROM public.tickets WHERE order_id=$1 ORDER BY id",[row.order_id]);
      tickets=tr.rows.map(t=>({ticketCode:t.ticket_code,checkedIn:Boolean(t.checked_in_at)}));
    }
    res.json({orderId:row.order_id,name:row.buyer_name,quantity:row.quantity,unitPrice:row.unit_price,totalAmount:row.total_amount,paymentStatus:row.payment_status,transactionStatus:row.transaction_status,paymentType:row.payment_type,tickets,createdAt:row.created_at,paidAt:row.paid_at,eventName:EVENT_NAME,eventDate:process.env.EVENT_DATE||"15 November 2026",eventLocation:process.env.EVENT_LOCATION||"Area Kampus 2 UIN K.H. Abdurrahman Wahid Pekalongan"});
  }catch(err){console.error(err);res.status(500).json({error:"Gagal memeriksa pesanan."});}
});

app.get("/api/admin/orders",requireAdmin,async(_req,res)=>{
  try{
    const result=await pool.query(`SELECT o.order_id,o.buyer_name,o.email,o.phone,o.quantity,o.unit_price,o.total_amount,o.payment_status,o.transaction_status,o.payment_type,o.created_at,o.paid_at,
      (SELECT COUNT(*)::int FROM public.tickets t WHERE t.order_id=o.order_id AND t.checked_in_at IS NOT NULL) AS checked_in_count
      FROM public.orders o ORDER BY o.created_at DESC LIMIT 1000`);
    const stats=await pool.query(`SELECT COUNT(*)::int AS orders,
      COALESCE(SUM(quantity) FILTER(WHERE payment_status='paid'),0)::int AS tickets_paid,
      COALESCE(SUM(total_amount) FILTER(WHERE payment_status='paid'),0)::bigint AS revenue FROM public.orders`);
    res.json({stats:stats.rows[0],orders:result.rows});
  }catch(err){console.error(err);res.status(500).json({error:"Gagal memuat dashboard."});}
});

app.post("/api/admin/checkin",requireAdmin,async(req,res)=>{
  const ticketCode=String(req.body.ticketCode||"").trim(),staff=String(req.body.checkedInBy||"Panitia").trim().slice(0,120);
  if(!ticketCode)return res.status(400).json({error:"Kode tiket wajib diisi."});
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const found=await client.query(`SELECT t.id,t.ticket_code,t.checked_in_at,o.order_id,o.buyer_name,o.payment_status
      FROM public.tickets t JOIN public.orders o ON o.order_id=t.order_id WHERE t.ticket_code=$1 FOR UPDATE OF t`,[ticketCode]);
    if(!found.rowCount){await client.query("ROLLBACK");return res.status(404).json({error:"Kode tiket tidak ditemukan."});}
    const t=found.rows[0];
    if(t.payment_status!=="paid"){await client.query("ROLLBACK");return res.status(409).json({error:"Pembayaran belum terkonfirmasi. Tiket tidak dapat digunakan."});}
    if(t.checked_in_at){await client.query("ROLLBACK");return res.status(409).json({error:`Tiket sudah check-in pada ${new Date(t.checked_in_at).toLocaleString("id-ID")}.`});}
    await client.query("UPDATE public.tickets SET checked_in_at=NOW(),checked_in_by=$1 WHERE id=$2",[staff,t.id]);
    await client.query("COMMIT");
    res.json({success:true,message:"Check-in berhasil.",ticketCode:t.ticket_code,orderId:t.order_id,buyerName:t.buyer_name});
  }catch(err){await client.query("ROLLBACK").catch(()=>{});console.error(err);res.status(500).json({error:"Check-in gagal."});}
  finally{client.release();}
});

module.exports = app;
