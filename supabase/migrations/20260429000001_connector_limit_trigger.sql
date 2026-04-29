-- Connector limit trigger: enforces plan-based connector limits at the DB level.
-- This is the bypass-proof gate — runs inside Postgres regardless of client code.
--
-- Limits:
--   free       → 1 cloud connector
--   managed    → 3 cloud connectors
--   enterprise → unlimited (9999)
--
-- EXCEPTION: 'obsidian' connectors are ALWAYS free and do NOT count toward the
-- plan limit. Obsidian is a local app — there is no cloud API, no server cost,
-- and no quota usage. Users can add Obsidian on top of any plan at no charge.

CREATE OR REPLACE FUNCTION public.check_connector_plan_limit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_plan        text;
  v_limit       int;
  v_count       int;
BEGIN
  -- Obsidian is always free — skip the limit check entirely.
  IF NEW.type = 'obsidian' THEN
    RETURN NEW;
  END IF;

  -- Get the user's current plan (default 'free' if no subscription row)
  SELECT COALESCE(plan, 'free')
    INTO v_plan
    FROM public.subscriptions
   WHERE user_id = NEW.user_id;

  IF v_plan IS NULL THEN v_plan := 'free'; END IF;

  -- Map plan to connector limit (cloud connectors only)
  v_limit := CASE v_plan
    WHEN 'managed'    THEN 3
    WHEN 'enterprise' THEN 9999
    ELSE 1  -- free
  END;

  -- Count existing CLOUD connectors for this user (exclude obsidian)
  SELECT COUNT(*) INTO v_count
    FROM public.connectors
   WHERE user_id = NEW.user_id
     AND type <> 'obsidian';

  IF v_count >= v_limit THEN
    RAISE EXCEPTION 'connector_limit_exceeded: plan=% limit=% current=%',
      v_plan, v_limit, v_count
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

-- Drop if exists (idempotent re-run)
DROP TRIGGER IF EXISTS trg_connector_plan_limit ON public.connectors;

CREATE TRIGGER trg_connector_plan_limit
  BEFORE INSERT ON public.connectors
  FOR EACH ROW EXECUTE FUNCTION public.check_connector_plan_limit();
