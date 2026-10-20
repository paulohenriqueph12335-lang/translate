-- Máscaras sempre em Word, aceitas mesmo sem marcadores (ADR-012, revisão de 2026-10-19): a edição fica guardada e
-- "aguardando configuração" até ter {{texto}}; só edições configuradas geram traduções.
ALTER TABLE sworn_translator_masks ADD COLUMN configured boolean NOT NULL DEFAULT true;
-- O que falta para a edição ficar pronta (ex.: falta {{texto}}), como a conferência informou no envio.
ALTER TABLE sworn_translator_masks ADD COLUMN issues text[] NOT NULL DEFAULT '{}';
UPDATE sworn_translator_masks SET configured = 'texto' = ANY (markers);
