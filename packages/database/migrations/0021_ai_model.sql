-- O Google retirou o gemini-2.5-flash para chaves novas (ADR-021): o padrão passa ao gemini-3.5-flash, estável e com
-- cota no plano gratuito (o 3.8 responde 503/429 com frequência).
ALTER TABLE ai_settings ALTER COLUMN model SET DEFAULT 'gemini-3.5-flash';
UPDATE ai_settings SET model = 'gemini-3.5-flash', updated_at = now()
 WHERE model LIKE 'gemini-2.5-%' OR model LIKE 'gemini-1.%' OR model = 'gemini-3.8-flash';
