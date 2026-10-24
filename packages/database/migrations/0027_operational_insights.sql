-- Lookups usados na auditoria, busca e no tempo até o primeiro download.
CREATE INDEX audit_events_target_action_idx ON audit_events(target_type,target_id,action,occurred_at DESC);
CREATE INDEX audit_events_action_id_idx ON audit_events(action,id DESC);
