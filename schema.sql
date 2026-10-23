-- Run this in Supabase SQL Editor.
-- Tables are accessed only by the backend with its database connection.
-- Do NOT expose the database password or Xendit Secret API Key and callback token in frontend code.

CREATE TABLE IF NOT EXISTS public.orders (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id VARCHAR(64) UNIQUE NOT NULL,
  buyer_name VARCHAR(120) NOT NULL,
  email VARCHAR(180) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 5),
  unit_price INTEGER NOT NULL CHECK (unit_price > 0),
  total_amount INTEGER NOT NULL CHECK (total_amount > 0),
  payment_status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending','paid','failed','cancelled')),
  transaction_status VARCHAR(40),
  payment_type VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.tickets (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_code VARCHAR(80) UNIQUE NOT NULL,
  order_id VARCHAR(64) NOT NULL REFERENCES public.orders(order_id) ON DELETE CASCADE,
  attendee_name VARCHAR(120),
  checked_in_at TIMESTAMPTZ,
  checked_in_by VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON public.orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_order ON public.tickets(order_id);
CREATE INDEX IF NOT EXISTS idx_tickets_code ON public.tickets(ticket_code);

-- Defense in depth: disable direct table access through the Supabase Data API.
-- Backend uses the PostgreSQL connection string, not the anon key.
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
-- No public policies are created intentionally.
