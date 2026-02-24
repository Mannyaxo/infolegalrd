-- Schema inicial para InfoLegal RD (ejecutar en SQL Editor de Supabase)

-- FAQs (preguntas frecuentes)
CREATE TABLE IF NOT EXISTS public.faqs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Consultas diarias por usuario (límite freemium)
CREATE TABLE IF NOT EXISTS public.consultas_diarias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  fecha DATE NOT NULL,
  cantidad INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, fecha)
);

-- Usuarios premium (Stripe)
CREATE TABLE IF NOT EXISTS public.usuarios_premium (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  stripe_subscription_id TEXT,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE public.faqs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "faqs public read" ON public.faqs FOR SELECT USING (true);

ALTER TABLE public.consultas_diarias ENABLE ROW LEVEL SECURITY;
CREATE POLICY "consultas_diarias select own" ON public.consultas_diarias FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "consultas_diarias insert own" ON public.consultas_diarias FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "consultas_diarias update own" ON public.consultas_diarias FOR UPDATE USING (auth.uid() = user_id);

ALTER TABLE public.usuarios_premium ENABLE ROW LEVEL SECURITY;
CREATE POLICY "usuarios_premium select own" ON public.usuarios_premium FOR SELECT USING (auth.uid() = user_id);

-- Datos iniciales opcionales (las FAQs por defecto están en el código; aquí puedes añadir más)
-- INSERT INTO public.faqs (category, question, answer) VALUES ...

-- Opcional: mejorar policy UPDATE para que valide también el nuevo row (ejecutar en SQL Editor si ya aplicaste el schema)
-- DROP POLICY IF EXISTS "consultas_diarias update own" ON public.consultas_diarias;
-- CREATE POLICY "consultas_diarias update own" ON public.consultas_diarias
--   FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
