-- Diretor não ocupa cargo de equipe (ADR-005): a regra também vale no banco,
-- para que nenhum caminho de código consiga rebaixar um Diretor a Líder/Operador.

-- Limpa associações existentes de Diretores, registrando na auditoria.
INSERT INTO audit_events (actor_user_id, action, target_type, target_id, team_id, metadata)
SELECT NULL, 'team.member_removed', 'user', m.user_id::text, m.team_id,
       jsonb_build_object('role', m.role, 'reason', 'director_cannot_hold_team_role', 'via', 'migration')
  FROM team_memberships m JOIN users u ON u.id = m.user_id
 WHERE u.org_role = 'director';

DELETE FROM team_memberships m USING users u WHERE u.id = m.user_id AND u.org_role = 'director';

CREATE FUNCTION team_memberships_reject_directors() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND org_role = 'director') THEN
    RAISE EXCEPTION 'Diretor não pode ocupar cargo de equipe' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER team_memberships_no_directors
  BEFORE INSERT OR UPDATE OF user_id ON team_memberships
  FOR EACH ROW EXECUTE FUNCTION team_memberships_reject_directors();

CREATE FUNCTION users_director_without_memberships() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM team_memberships WHERE user_id = NEW.id) THEN
    RAISE EXCEPTION 'Remova as associações de equipe antes de promover a Diretor' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER users_director_no_memberships
  BEFORE UPDATE OF org_role ON users
  FOR EACH ROW WHEN (NEW.org_role = 'director' AND OLD.org_role IS DISTINCT FROM 'director')
  EXECUTE FUNCTION users_director_without_memberships();
