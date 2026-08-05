--
-- PostgreSQL database dump
--

\restrict wGNj7nLjg1B9fycbDO1NucSemE8eCuLOTONDVaTaMZaec86UkyV5Zc0r9efT52v

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: app_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_role AS ENUM (
    'super_admin',
    'member',
    'user'
);


--
-- Name: author_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.author_type AS ENUM (
    'human',
    'agent'
);


--
-- Name: channel_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.channel_type AS ENUM (
    'public',
    'private',
    'dm'
);


--
-- Name: channel_messages_dedup_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.channel_messages_dedup_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.content IS NULL OR NEW.content = '' OR NEW.thread_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.channel_messages cm
    WHERE cm.channel_id = NEW.channel_id
      AND cm.author_id = NEW.author_id
      AND cm.content = NEW.content
      AND cm.thread_id IS NULL
      AND cm.deleted_at IS NULL
      AND cm.created_at >= COALESCE(NEW.created_at, now()) - interval '2 seconds'
      AND cm.created_at <= COALESCE(NEW.created_at, now())
  ) THEN
    -- Silently drop the duplicate insert; the first row is already visible
    -- via realtime, and the client doesn't need an error here.
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: check_invoke_rate(uuid, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_invoke_rate(_user_id uuid, _limit integer, _window_secs integer) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _row public.integration_rate_limit%ROWTYPE;
BEGIN
  SELECT * INTO _row FROM public.integration_rate_limit WHERE user_id = _user_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.integration_rate_limit(user_id, window_start, count) VALUES (_user_id, now(), 1);
    RETURN true;
  END IF;
  IF _row.window_start < now() - make_interval(secs => _window_secs) THEN
    UPDATE public.integration_rate_limit SET window_start = now(), count = 1 WHERE user_id = _user_id;
    RETURN true;
  END IF;
  IF _row.count >= _limit THEN
    RETURN false;
  END IF;
  UPDATE public.integration_rate_limit SET count = count + 1 WHERE user_id = _user_id;
  RETURN true;
END;
$$;


--
-- Name: cleanup_agent_activity_log(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_agent_activity_log() RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  DELETE FROM public.agent_activity_log WHERE timestamp < now() - interval '7 days';
$$;


--
-- Name: delete_email(text, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.delete_email(queue_name text, message_id bigint) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  RETURN pgmq.delete(queue_name, message_id);
EXCEPTION WHEN undefined_table THEN
  RETURN FALSE;
END;
$$;


--
-- Name: email_queue_dispatch(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.email_queue_dispatch() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pgmq.q_auth_emails)
     AND NOT EXISTS (SELECT 1 FROM pgmq.q_transactional_emails) THEN
    BEGIN
      -- Serialize disarm against email_queue_wake on a shared advisory lock, then
      -- re-read under it: an enqueue racing the unschedule either committed (we
      -- see its row and leave the cron) or waits and re-arms after we commit.
      PERFORM pg_catalog.pg_advisory_xact_lock(7700000000000001);
      IF EXISTS (SELECT 1 FROM pgmq.q_auth_emails)
         OR EXISTS (SELECT 1 FROM pgmq.q_transactional_emails) THEN
        RETURN;
      END IF;
      PERFORM cron.unschedule('process-email-queue');
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'email_queue_dispatch: cron unschedule failed: %', SQLERRM;
    END;
    RETURN;
  END IF;

  IF (SELECT retry_after_until FROM public.email_send_state WHERE id = 1) > now() THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://zozyfhisrbkqvdcsdbfp.supabase.co/functions/v1/process-email-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Lovable-Context', 'cron',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key'
      )
    ),
    body := '{}'::jsonb
  );
END;
$$;


--
-- Name: email_queue_wake(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.email_queue_wake() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
BEGIN
  -- Runs inside the enqueue transaction; the outer handler guarantees nothing
  -- below can roll back the customer's email. Shared advisory lock serializes
  -- arming against email_queue_dispatch's disarm.
  PERFORM pg_catalog.pg_advisory_xact_lock(7700000000000001);
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-email-queue') THEN
    BEGIN
      PERFORM cron.schedule('process-email-queue', '5 seconds', $cron$ SELECT public.email_queue_dispatch(); $cron$);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'email_queue_wake: cron schedule failed: %', SQLERRM;
    END;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url := 'https://zozyfhisrbkqvdcsdbfp.supabase.co/functions/v1/process-email-queue',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Lovable-Context', 'cron',
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key'
        )
      ),
      body := '{}'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'email_queue_wake failed (enqueue preserved): %', SQLERRM;
  RETURN NULL;
END;
$_$;


--
-- Name: enqueue_email(text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enqueue_email(queue_name text, payload jsonb) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  RETURN pgmq.send(queue_name, payload);
EXCEPTION WHEN undefined_table THEN
  PERFORM pgmq.create(queue_name);
  RETURN pgmq.send(queue_name, payload);
END;
$$;


--
-- Name: find_or_create_agent_agent_dm(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_or_create_agent_agent_dm(_sender_agent_id text, _recipient_agent_id text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _channel_id uuid;
BEGIN
  -- Find existing DM channel where both agents are members
  SELECT cm1.channel_id INTO _channel_id
  FROM channel_members cm1
  JOIN channel_members cm2 ON cm2.channel_id = cm1.channel_id
  JOIN channels c ON c.id = cm1.channel_id
  WHERE cm1.user_id = _sender_agent_id
    AND cm1.member_type = 'agent'
    AND cm2.user_id = _recipient_agent_id
    AND cm2.member_type = 'agent'
    AND c.type = 'dm'
  LIMIT 1;

  IF _channel_id IS NOT NULL THEN
    RETURN _channel_id;
  END IF;

  -- Also check reverse order
  SELECT cm1.channel_id INTO _channel_id
  FROM channel_members cm1
  JOIN channel_members cm2 ON cm2.channel_id = cm1.channel_id
  JOIN channels c ON c.id = cm1.channel_id
  WHERE cm1.user_id = _recipient_agent_id
    AND cm1.member_type = 'agent'
    AND cm2.user_id = _sender_agent_id
    AND cm2.member_type = 'agent'
    AND c.type = 'dm'
  LIMIT 1;

  IF _channel_id IS NOT NULL THEN
    RETURN _channel_id;
  END IF;

  -- Create new DM channel for agent-to-agent
  INSERT INTO channels (name, description, type, created_by)
  VALUES (
    _sender_agent_id || ' ↔ ' || _recipient_agent_id,
    'Agent-to-agent DM',
    'dm',
    '00000000-0000-0000-0000-000000000000'::uuid
  )
  RETURNING id INTO _channel_id;

  -- Add both agents as members
  INSERT INTO channel_members (channel_id, user_id, member_type)
  VALUES
    (_channel_id, _sender_agent_id, 'agent'),
    (_channel_id, _recipient_agent_id, 'agent');

  RETURN _channel_id;
END;
$$;


--
-- Name: find_or_create_agent_dm(text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_or_create_agent_dm(_agent_id text, _agent_name text, _target_user_id uuid) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _channel_id uuid;
BEGIN
  -- Find existing DM channel where agent and user are both members
  SELECT cm1.channel_id INTO _channel_id
  FROM channel_members cm1
  JOIN channel_members cm2 ON cm2.channel_id = cm1.channel_id
  JOIN channels c ON c.id = cm1.channel_id
  WHERE cm1.user_id = _agent_id
    AND cm1.member_type = 'agent'
    AND cm2.user_id = _target_user_id::text
    AND cm2.member_type = 'human'
    AND c.type = 'dm'
  LIMIT 1;

  IF _channel_id IS NOT NULL THEN
    RETURN _channel_id;
  END IF;

  -- Create new DM channel
  INSERT INTO channels (name, description, type, created_by)
  VALUES (_agent_name, NULL, 'dm', _target_user_id)
  RETURNING id INTO _channel_id;

  -- Add agent and user as members
  INSERT INTO channel_members (channel_id, user_id, member_type)
  VALUES
    (_channel_id, _agent_id, 'agent'),
    (_channel_id, _target_user_id::text, 'human');

  RETURN _channel_id;
END;
$$;


--
-- Name: find_or_create_dm(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_or_create_dm(_target_user_id uuid, _target_name text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _current_user_id uuid := auth.uid();
  _channel_id uuid;
BEGIN
  IF _current_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Find existing DM channel where both users are members
  SELECT cm1.channel_id INTO _channel_id
  FROM channel_members cm1
  JOIN channel_members cm2 ON cm2.channel_id = cm1.channel_id
  JOIN channels c ON c.id = cm1.channel_id
  WHERE cm1.user_id = _current_user_id::text
    AND cm1.member_type = 'human'
    AND cm2.user_id = _target_user_id::text
    AND cm2.member_type = 'human'
    AND c.type = 'dm'
  LIMIT 1;

  IF _channel_id IS NOT NULL THEN
    RETURN _channel_id;
  END IF;

  -- Create new DM channel
  INSERT INTO channels (name, description, type, created_by)
  VALUES (_target_name, NULL, 'dm', _current_user_id)
  RETURNING id INTO _channel_id;

  -- Add both users as members
  INSERT INTO channel_members (channel_id, user_id, member_type)
  VALUES
    (_channel_id, _current_user_id::text, 'human'),
    (_channel_id, _target_user_id::text, 'human');

  RETURN _channel_id;
END;
$$;


--
-- Name: get_agents_last_activity(text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_agents_last_activity(_agent_ids text[]) RETURNS TABLE(agent_id text, last_active timestamp with time zone, last_content text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT DISTINCT ON (c.agent_id)
    c.agent_id,
    c.created_at AS last_active,
    LEFT(c.content, 120) AS last_content
  FROM conversations c
  WHERE c.agent_id = ANY(_agent_ids)
  ORDER BY c.agent_id, c.created_at DESC;
$$;


--
-- Name: get_agents_last_activity(text[], uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_agents_last_activity(_agent_ids text[], _user_id uuid DEFAULT NULL::uuid) RETURNS TABLE(agent_id text, last_active timestamp with time zone, last_content text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT DISTINCT ON (c.agent_id)
    c.agent_id,
    c.created_at AS last_active,
    LEFT(c.content, 120) AS last_content
  FROM conversations c
  WHERE c.agent_id = ANY(_agent_ids)
    AND (_user_id IS NULL OR c.user_id = _user_id)
  ORDER BY c.agent_id, c.created_at DESC;
$$;


--
-- Name: get_fleet_productivity(timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_fleet_productivity(_since timestamp with time zone) RETURNS TABLE(agent_id text, conv_count bigint, result_count bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    a.agent_id,
    COALESCE(conv.cnt, 0) AS conv_count,
    COALESCE(res.cnt, 0) AS result_count
  FROM (SELECT DISTINCT unnest AS agent_id FROM unnest(
    (SELECT array_agg(DISTINCT ta.agent_id) FROM team_agents ta)
  )) a
  LEFT JOIN (
    SELECT c.agent_id, COUNT(*) AS cnt
    FROM conversations c
    WHERE c.created_at >= _since
    GROUP BY c.agent_id
  ) conv ON conv.agent_id = a.agent_id
  LEFT JOIN (
    SELECT r.agent_id, COUNT(*) AS cnt
    FROM agent_results r
    WHERE r.created_at >= _since
    GROUP BY r.agent_id
  ) res ON res.agent_id = a.agent_id;
$$;


--
-- Name: get_user_agent_activity(timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_user_agent_activity(_since timestamp with time zone) RETURNS TABLE(user_id uuid, agent_id text, session_count bigint, last_active timestamp with time zone)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
    SELECT c.user_id, c.agent_id, COUNT(*)::bigint AS session_count, MAX(c.created_at) AS last_active
    FROM public.conversations c
    WHERE c.created_at >= _since
    GROUP BY c.user_id, c.agent_id
    ORDER BY COUNT(*) DESC;
END;
$$;


--
-- Name: get_user_role(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_user_role(_user_id uuid) RETURNS public.app_role
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT role FROM public.user_roles
  WHERE user_id = _user_id
  ORDER BY CASE role
    WHEN 'super_admin' THEN 1
    WHEN 'member' THEN 2
    WHEN 'user' THEN 3
  END
  LIMIT 1
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _default_channel_id uuid;
BEGIN
  INSERT INTO public.profiles (id, email, full_name, status)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name',''),
    CASE WHEN NEW.invited_at IS NOT NULL THEN 'pending' ELSE 'active' END
  );

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user')
  ON CONFLICT DO NOTHING;

  -- Auto-join first public channel (dynamic — no hardcoded UUID)
  SELECT id INTO _default_channel_id
  FROM public.channels
  WHERE type = 'public'
  ORDER BY created_at ASC
  LIMIT 1;

  IF _default_channel_id IS NOT NULL THEN
    INSERT INTO public.channel_members (channel_id, user_id, member_type)
    VALUES (_default_channel_id, NEW.id::text, 'human')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: has_role(uuid, public.app_role); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;


--
-- Name: invoke_edge_function(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.invoke_edge_function(_fn text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  _url TEXT;
  _key TEXT;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO _url
    FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    _url := NULL;
  END;

  IF _url IS NULL OR _url = '' THEN
    RAISE WARNING 'invoke_edge_function(%): vault project_url ausente — pulando.', _fn;
    RETURN;
  END IF;

  BEGIN
    SELECT decrypted_secret INTO _key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    _key := NULL;
  END;
  _key := COALESCE(NULLIF(_key, ''), current_setting('app.settings.service_role_key', true), '');

  PERFORM net.http_post(
    url := _url || '/functions/v1/' || _fn,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Lovable-Context', 'cron',
      'Authorization', 'Bearer ' || _key,
      'apikey', _key
    ),
    body := '{}'::jsonb
  );
END;
$$;


--
-- Name: is_channel_member(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_channel_member(_channel_id uuid, _user_id text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.channel_members
    WHERE channel_id = _channel_id AND user_id = _user_id
  )
$$;


--
-- Name: is_public_channel(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_public_channel(_channel_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.channels
    WHERE id = _channel_id AND type = 'public'
  )
$$;


--
-- Name: mark_agent_turn_delivered(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_agent_turn_delivered() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.role = 'agent' AND NEW.agent_id IS NOT NULL AND NEW.user_id IS NOT NULL
     AND NOT (
       NEW.content ILIKE 'no response from%'
       OR NEW.content ILIKE 'sem resposta do agente%'
       OR NEW.content LIKE '%⌛ Resposta interrompida%'
       OR NEW.content LIKE '⚠️ Não consegui finalizar%'
       OR NEW.content LIKE '⏳ Ainda trabalhando%'
       OR NEW.content LIKE '⚠️ Sem retorno há%'
     )
  THEN
    UPDATE public.agent_turns
    SET status = 'delivered', delivered_at = now()
    WHERE agent_id = NEW.agent_id
      AND user_id = NEW.user_id
      AND status = 'pending';
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: move_to_dlq(text, text, bigint, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.move_to_dlq(source_queue text, dlq_name text, message_id bigint, payload jsonb) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
DECLARE new_id BIGINT;
BEGIN
  SELECT pgmq.send(dlq_name, payload) INTO new_id;
  PERFORM pgmq.delete(source_queue, message_id);
  RETURN new_id;
EXCEPTION WHEN undefined_table THEN
  BEGIN
    PERFORM pgmq.create(dlq_name);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  SELECT pgmq.send(dlq_name, payload) INTO new_id;
  BEGIN
    PERFORM pgmq.delete(source_queue, message_id);
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;
  RETURN new_id;
END;
$$;


--
-- Name: post_task_completion_to_chat(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.post_task_completion_to_chat() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _notes text;
  _msg text;
BEGIN
  -- Only fire when transitioning INTO 'done' (skip inserts already-done, avoid loops)
  IF NEW.status <> 'done' THEN RETURN NEW; END IF;
  IF OLD.status = 'done' THEN RETURN NEW; END IF;
  IF NEW.created_by IS NULL THEN RETURN NEW; END IF;

  _notes := COALESCE(NULLIF(btrim(NEW.checkpoint_data->>'notes'), ''), 'Sem notas adicionais.');
  _msg := 'Task concluída: ' || COALESCE(NEW.title, 'sem título') || E'\n\n' || _notes;

  INSERT INTO public.conversations (agent_id, user_id, role, content, created_at)
  VALUES (NEW.agent_id, NEW.created_by, 'agent', _msg, now());

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'post_task_completion_to_chat failed: %', SQLERRM;
  RETURN NEW;
END;
$$;


--
-- Name: read_email_batch(text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.read_email_batch(queue_name text, batch_size integer, vt integer) RETURNS TABLE(msg_id bigint, read_ct integer, message jsonb)
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  RETURN QUERY SELECT r.msg_id, r.read_ct, r.message FROM pgmq.read(queue_name, vt, batch_size) r;
EXCEPTION WHEN undefined_table THEN
  PERFORM pgmq.create(queue_name);
  RETURN;
END;
$$;


--
-- Name: run_zombie_watchdog(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.run_zombie_watchdog() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  _tasks int; _runs int; _agents int; _activities int; _stats int;
BEGIN
  UPDATE public.agent_tasks
     SET status = 'failed', updated_at = now()
   WHERE status IN ('running','checkpoint')
     AND updated_at < now() - interval '30 minutes';
  GET DIAGNOSTICS _tasks = ROW_COUNT;

  UPDATE public.automation_runs
     SET status = 'error', finished_at = now()
   WHERE status = 'running'
     AND started_at < now() - interval '15 minutes';
  GET DIAGNOSTICS _runs = ROW_COUNT;

  UPDATE public.agent_profiles
     SET status = 'inactive'
   WHERE status = 'configuring'
     AND updated_at < now() - interval '30 minutes';
  GET DIAGNOSTICS _agents = ROW_COUNT;

  UPDATE public.agent_activity
     SET status = 'failed', updated_at = now()
   WHERE status IN ('running','in_progress','pending','working')
     AND updated_at < now() - interval '15 minutes';
  GET DIAGNOSTICS _activities = ROW_COUNT;

  UPDATE public.agent_stats
     SET status = 'offline'
   WHERE status = 'online'
     AND last_active < now() - interval '15 minutes';
  GET DIAGNOSTICS _stats = ROW_COUNT;

  IF _tasks > 0 OR _runs > 0 OR _agents > 0 OR _activities > 0 OR _stats > 0 THEN
    RAISE NOTICE 'zombie-watchdog: % tasks, % runs, % agents, % activities, % stats marcados.', _tasks, _runs, _agents, _activities, _stats;
  END IF;
END;
$$;


--
-- Name: set_drafts_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_drafts_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: sync_channel_members_rest_fields(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_channel_members_rest_fields() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
  _channel_name text;
BEGIN
  IF NEW.id IS NULL THEN
    NEW.id := gen_random_uuid();
  END IF;

  NEW.member_id := COALESCE(NEW.member_id, NEW.user_id);
  NEW.added_at := COALESCE(NEW.added_at, NEW.joined_at, now());
  NEW.joined_at := COALESCE(NEW.joined_at, NEW.added_at, now());

  SELECT name INTO _channel_name
  FROM public.channels
  WHERE id = NEW.channel_id;

  NEW.channel := COALESCE(_channel_name, NEW.channel);

  RETURN NEW;
END;
$$;


--
-- Name: trigger_send_push_on_notification(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trigger_send_push_on_notification() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  _supabase_url TEXT;
  _service_role_key TEXT;
  _url TEXT;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO _supabase_url
    FROM vault.decrypted_secrets
    WHERE name = 'project_url'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    _supabase_url := NULL;
  END;
  -- Fallback kept for one release; remove once remix ships and all deployments have the vault entry.
  _supabase_url := COALESCE(NULLIF(_supabase_url, ''), 'https://zozyfhisrbkqvdcsdbfp.supabase.co');

  BEGIN
    SELECT decrypted_secret INTO _service_role_key
    FROM vault.decrypted_secrets
    WHERE name = 'service_role_key'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    _service_role_key := NULL;
  END;

  IF NEW.agent_id IS NOT NULL AND btrim(NEW.agent_id) <> '' THEN
    _url := '/chat?agent=' || NEW.agent_id;
  ELSIF NEW.channel_id IS NOT NULL THEN
    _url := '/chat?channel=' || NEW.channel_id::text;
  ELSE
    _url := '/';
  END IF;

  PERFORM net.http_post(
    url := _supabase_url || '/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(_service_role_key, current_setting('app.settings.service_role_key', true))
    ),
    body := jsonb_build_object(
      'user_id', NEW.user_id,
      'title', 'Nova mensagem de ' || NEW.author_name,
      'body', LEFT(COALESCE(NEW.content_preview, ''), 120),
      'channel_id', NEW.channel_id,
      'agent_id', NEW.agent_id,
      'message_id', NEW.message_id,
      'notification_id', NEW.id,
      'url', _url
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: upsert_platform_vault(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_platform_vault(_project_url text, _service_role_key text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  _id uuid;
BEGIN
  IF _project_url IS NULL OR _project_url = '' THEN
    RAISE EXCEPTION 'project_url vazio';
  END IF;

  SELECT id INTO _id FROM vault.secrets WHERE name = 'project_url';
  IF _id IS NULL THEN
    PERFORM vault.create_secret(_project_url, 'project_url', 'Base URL deste projeto (auto-set pelo setup).');
  ELSE
    PERFORM vault.update_secret(_id, _project_url, 'project_url', 'Base URL deste projeto (auto-set pelo setup).');
  END IF;

  IF _service_role_key IS NOT NULL AND _service_role_key <> '' THEN
    SELECT id INTO _id FROM vault.secrets WHERE name = 'service_role_key';
    IF _id IS NULL THEN
      PERFORM vault.create_secret(_service_role_key, 'service_role_key', 'Service role key deste projeto (auto-set pelo setup).');
    ELSE
      PERFORM vault.update_secret(_id, _service_role_key, 'service_role_key', 'Service role key deste projeto (auto-set pelo setup).');
    END IF;

    SELECT id INTO _id FROM vault.secrets WHERE name = 'email_queue_service_role_key';
    IF _id IS NULL THEN
      PERFORM vault.create_secret(_service_role_key, 'email_queue_service_role_key', 'Service role key (fila de e-mail, auto-set pelo setup).');
    ELSE
      PERFORM vault.update_secret(_id, _service_role_key, 'email_queue_service_role_key', 'Service role key (fila de e-mail, auto-set pelo setup).');
    END IF;
  END IF;
END;
$$;


--
-- Name: wiki_documents_set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.wiki_documents_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: access_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.access_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    action text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: agent_activity; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_activity (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id text NOT NULL,
    activity_type text NOT NULL,
    title text NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    steps jsonb DEFAULT '[]'::jsonb NOT NULL,
    result jsonb,
    user_id uuid,
    channel text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.agent_activity REPLICA IDENTITY FULL;


--
-- Name: agent_activity_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_activity_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id text NOT NULL,
    agent_name text NOT NULL,
    agent_emoji text,
    event_type text NOT NULL,
    tool_name text,
    detail text NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    session_key text,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.agent_activity_log REPLICA IDENTITY FULL;


--
-- Name: agent_avatars; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_avatars (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id text NOT NULL,
    avatar_data text NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    avatar_url text
);


--
-- Name: agent_context_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_context_state (
    session_key text NOT NULL,
    agent_id text NOT NULL,
    model text,
    total_tokens bigint DEFAULT 0 NOT NULL,
    context_tokens bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_creation_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_creation_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id text NOT NULL,
    created_by uuid,
    briefing text NOT NULL,
    lia_session text,
    lia_http_status integer,
    lia_response text,
    lia_error text,
    status text DEFAULT 'sent'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    responded_at timestamp with time zone,
    CONSTRAINT agent_creation_log_status_check CHECK ((status = ANY (ARRAY['sent'::text, 'responded'::text, 'failed'::text, 'timeout'::text])))
);


--
-- Name: agent_crons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_crons (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id text NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    expression text DEFAULT '* * * * *'::text NOT NULL,
    description text DEFAULT ''::text,
    enabled boolean DEFAULT true NOT NULL,
    last_run timestamp with time zone,
    next_run timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_files (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id text NOT NULL,
    file_name text NOT NULL,
    content text,
    synced_at timestamp with time zone DEFAULT now(),
    pending_write boolean DEFAULT false NOT NULL,
    origin text DEFAULT 'vps'::text NOT NULL,
    written_at timestamp with time zone
);


--
-- Name: agent_integrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_integrations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id text,
    name text NOT NULL,
    type text,
    status text DEFAULT 'inactive'::text,
    config jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    description text,
    CONSTRAINT agent_integrations_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text, 'error'::text]))),
    CONSTRAINT agent_integrations_type_check CHECK ((type = ANY (ARRAY['channel'::text, 'tool'::text, 'api'::text, 'mcp'::text, 'skill'::text])))
);


--
-- Name: agent_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_profiles (
    agent_id text NOT NULL,
    avatar_url text,
    department text,
    tts_voice_id text,
    tts_voice_name text,
    convai_agent_id text,
    voice_model text DEFAULT 'eleven_multilingual_v2'::text,
    updated_at timestamp with time zone DEFAULT now(),
    role text,
    description text,
    name text,
    emoji text DEFAULT '🤖'::text,
    specialty text,
    workspace text,
    channels text[] DEFAULT ARRAY[]::text[],
    openclaw_id text,
    status text DEFAULT 'active'::text NOT NULL,
    model text,
    behavior text,
    skills_description text,
    skills_tags text[] DEFAULT '{}'::text[],
    integrations_used text[] DEFAULT '{}'::text[],
    persona_description text,
    crons_description text,
    access_type text DEFAULT 'all'::text NOT NULL,
    allowed_user_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    guardrails jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_leader boolean DEFAULT false NOT NULL,
    leader_id text,
    is_official boolean DEFAULT false NOT NULL,
    sort_order integer,
    color text,
    CONSTRAINT agent_profiles_access_type_check CHECK ((access_type = ANY (ARRAY['all'::text, 'admins_only'::text, 'specific_users'::text]))),
    CONSTRAINT agent_profiles_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text, 'configuring'::text])))
);


--
-- Name: agent_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id text NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    description text DEFAULT ''::text,
    category text DEFAULT 'task'::text,
    value numeric,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id text
);


--
-- Name: agent_skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_skills (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    agent_id text NOT NULL,
    skill_id uuid NOT NULL,
    installed_by text DEFAULT 'user'::text NOT NULL,
    sync_status text DEFAULT 'pending'::text NOT NULL,
    sync_error text,
    CONSTRAINT agent_skills_installed_by_check CHECK ((installed_by = ANY (ARRAY['user'::text, 'agent'::text, 'sync'::text, 'default'::text]))),
    CONSTRAINT agent_skills_sync_status_check CHECK ((sync_status = ANY (ARRAY['pending'::text, 'synced'::text, 'error'::text, 'removing'::text])))
);

ALTER TABLE ONLY public.agent_skills REPLICA IDENTITY FULL;


--
-- Name: agent_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_stats (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id text NOT NULL,
    status text,
    model text,
    last_active timestamp with time zone,
    last_channel text,
    messages_today integer DEFAULT 0,
    tokens_today integer DEFAULT 0,
    cost_today numeric DEFAULT 0,
    errors_today integer DEFAULT 0,
    collected_at timestamp with time zone DEFAULT now(),
    session_count integer,
    max_total_tokens integer,
    latest_updated_at timestamp with time zone,
    top_sessions jsonb,
    user_id uuid
);


--
-- Name: agent_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    agent_id text NOT NULL,
    title text NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    chunks jsonb DEFAULT '[]'::jsonb NOT NULL,
    checkpoint_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT agent_tasks_status_check CHECK ((status = ANY (ARRAY['running'::text, 'checkpoint'::text, 'done'::text, 'failed'::text])))
);

ALTER TABLE ONLY public.agent_tasks REPLICA IDENTITY FULL;


--
-- Name: agent_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_templates (
    agent_id text NOT NULL,
    name text NOT NULL,
    role text,
    specialty text,
    department text,
    emoji text DEFAULT '🤖'::text,
    identity_template text NOT NULL,
    soul_template text NOT NULL,
    suggested_channels text[] DEFAULT '{}'::text[] NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_default_active boolean DEFAULT true NOT NULL,
    is_leader_template boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    color text
);


--
-- Name: agent_token_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_token_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id text NOT NULL,
    total_tokens integer DEFAULT 0,
    input_tokens integer DEFAULT 0,
    output_tokens integer DEFAULT 0,
    session_count integer DEFAULT 0,
    snapshot_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    context_tokens integer DEFAULT 0,
    cache_read bigint DEFAULT 0,
    cache_write bigint DEFAULT 0,
    estimated_cost_usd numeric(10,6) DEFAULT 0,
    model text,
    context_window bigint
);


--
-- Name: agent_turn_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_turn_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    turn_id uuid,
    session_key text NOT NULL,
    observed text NOT NULL,
    decision text NOT NULL,
    acted boolean DEFAULT false NOT NULL,
    detail text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_turns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_turns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id text NOT NULL,
    user_id uuid,
    session_key text NOT NULL,
    user_message_ts timestamp with time zone NOT NULL,
    source text DEFAULT 'dm'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    dispatched_at timestamp with time zone DEFAULT now() NOT NULL,
    delivered_at timestamp with time zone,
    detail text,
    attempts integer DEFAULT 0 NOT NULL,
    last_checked_at timestamp with time zone,
    nudged_at timestamp with time zone,
    last_decision text,
    warned_soft_at timestamp with time zone,
    warned_hard_at timestamp with time zone,
    origin_agent_id text,
    CONSTRAINT agent_turns_tem_origem CHECK (((user_id IS NOT NULL) OR (origin_agent_id IS NOT NULL)))
);


--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    value jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: arena_agents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.arena_agents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    arena_id uuid NOT NULL,
    agent_id text NOT NULL,
    role_name text,
    role_description text,
    is_primary boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: arena_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.arena_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    role text NOT NULL,
    agent_id text,
    agent_role text,
    content text,
    artifact_html text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: arena_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.arena_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    arena_id uuid NOT NULL,
    title text DEFAULT 'Nova sessão'::text,
    parent_session_id uuid,
    context_summary text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: arena_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.arena_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    emoji text,
    description text,
    agents jsonb DEFAULT '[]'::jsonb,
    suggested_sessions text[] DEFAULT '{}'::text[],
    base_prompt text,
    is_default boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: arenas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.arenas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text,
    emoji text DEFAULT ''::text,
    agents jsonb DEFAULT '[]'::jsonb,
    react_code text DEFAULT ''::text,
    prompt text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    voice_id text,
    opening_message text,
    convai_agent_id text,
    created_by uuid DEFAULT auth.uid() NOT NULL
);


--
-- Name: artifact_titles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artifact_titles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    message_id uuid NOT NULL,
    title text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: artifacts_published; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artifacts_published (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text,
    html_content text NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone,
    views integer DEFAULT 0,
    is_public boolean DEFAULT true
);


--
-- Name: automation_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    automation_id uuid,
    cron_job_name text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    status text,
    output text,
    error_message text,
    CONSTRAINT automation_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'success'::text, 'error'::text])))
);


--
-- Name: automations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    agent_id text,
    type text NOT NULL,
    scheduled_day text,
    scheduled_time text,
    trigger_event text,
    instruction text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    last_run_at timestamp with time zone,
    last_run_status text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT automations_last_run_status_check CHECK ((last_run_status = ANY (ARRAY['success'::text, 'error'::text, 'running'::text]))),
    CONSTRAINT automations_scheduled_day_check CHECK ((scheduled_day = ANY (ARRAY['monday'::text, 'tuesday'::text, 'wednesday'::text, 'thursday'::text, 'friday'::text, 'saturday'::text, 'sunday'::text, 'daily'::text]))),
    CONSTRAINT automations_trigger_event_check CHECK ((trigger_event = ANY (ARRAY['gateway.offline'::text, 'integration.added'::text, 'integration.expired'::text, 'user.joined'::text, 'agent.error'::text]))),
    CONSTRAINT automations_type_check CHECK ((type = ANY (ARRAY['scheduled'::text, 'trigger'::text])))
);


--
-- Name: branding; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.branding (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_name text DEFAULT 'OpenClaw'::text NOT NULL,
    primary_color text DEFAULT '231 100% 62%'::text NOT NULL,
    logo text DEFAULT ''::text,
    favicon_url text DEFAULT ''::text,
    updated_at timestamp with time zone DEFAULT now(),
    pwa_icon_url text,
    logo_light text,
    logo_dark text,
    mark_light text,
    mark_dark text
);


--
-- Name: channel_agent_activity; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.channel_agent_activity (
    channel_id uuid NOT NULL,
    agent_id text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    passo text,
    finished_at timestamp with time zone
);

ALTER TABLE ONLY public.channel_agent_activity REPLICA IDENTITY FULL;


--
-- Name: channel_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.channel_members (
    channel_id uuid NOT NULL,
    user_id text NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    member_type text DEFAULT 'human'::text NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    channel text,
    member_id text NOT NULL,
    added_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: channel_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.channel_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    channel_id uuid NOT NULL,
    author_id text NOT NULL,
    author_type public.author_type DEFAULT 'human'::public.author_type NOT NULL,
    author_name text NOT NULL,
    author_avatar text,
    content text NOT NULL,
    thread_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    audio_url text,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    attachments jsonb
);

ALTER TABLE ONLY public.channel_messages REPLICA IDENTITY FULL;


--
-- Name: channels; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.channels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    type public.channel_type DEFAULT 'public'::public.channel_type NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: company_profile; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.company_profile (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_name text,
    founder_name text,
    segment text,
    description text,
    target_audience text,
    products_services text,
    tone text,
    revenue text,
    employees_count text,
    extra_context text,
    onboarding_notified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT company_profile_tone_check CHECK (((tone IS NULL) OR (tone = ANY (ARRAY['formal'::text, 'informal'::text, 'técnico'::text, 'descontraído'::text]))))
);


--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id text NOT NULL,
    role text NOT NULL,
    content text DEFAULT ''::text,
    media jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid NOT NULL,
    CONSTRAINT conversations_role_check CHECK ((role = ANY (ARRAY['user'::text, 'agent'::text])))
);

ALTER TABLE ONLY public.conversations REPLICA IDENTITY FULL;


--
-- Name: cron_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cron_jobs (
    id text NOT NULL,
    name text,
    agent text,
    cron_expression text,
    status text,
    enabled boolean,
    last_run timestamp with time zone,
    next_run timestamp with time zone,
    prompt text,
    collected_at timestamp with time zone DEFAULT now()
);


--
-- Name: dm_reads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dm_reads (
    channel_id uuid NOT NULL,
    user_id uuid NOT NULL,
    last_read_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.dm_reads REPLICA IDENTITY FULL;


--
-- Name: drafts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.drafts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    draft_key text NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY public.drafts REPLICA IDENTITY FULL;


--
-- Name: email_send_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_send_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    message_id text,
    template_name text NOT NULL,
    recipient_email text NOT NULL,
    status text NOT NULL,
    error_message text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_send_log_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'suppressed'::text, 'failed'::text, 'bounced'::text, 'complained'::text, 'dlq'::text])))
);


--
-- Name: email_send_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_send_state (
    id integer DEFAULT 1 NOT NULL,
    retry_after_until timestamp with time zone,
    batch_size integer DEFAULT 10 NOT NULL,
    send_delay_ms integer DEFAULT 200 NOT NULL,
    auth_email_ttl_minutes integer DEFAULT 15 NOT NULL,
    transactional_email_ttl_minutes integer DEFAULT 60 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT email_send_state_id_check CHECK ((id = 1))
);


--
-- Name: email_unsubscribe_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_unsubscribe_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    token text NOT NULL,
    email text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    used_at timestamp with time zone
);


--
-- Name: gateway_health; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gateway_health (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    status text,
    version text,
    uptime_seconds integer,
    latency_ms integer,
    collected_at timestamp with time zone DEFAULT now()
);


--
-- Name: generated_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.generated_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    agent_id text,
    title text NOT NULL,
    doc_type text NOT NULL,
    storage_path text NOT NULL,
    size_bytes integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT generated_documents_doc_type_check CHECK ((doc_type = ANY (ARRAY['pdf'::text, 'docx'::text])))
);


--
-- Name: integration_rate_limit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.integration_rate_limit (
    user_id uuid NOT NULL,
    window_start timestamp with time zone DEFAULT now() NOT NULL,
    count integer DEFAULT 0 NOT NULL
);


--
-- Name: integration_secrets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.integration_secrets (
    name text NOT NULL,
    value text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: integration_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.integration_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    integration_type text NOT NULL,
    label text NOT NULL,
    icon text DEFAULT '🔗'::text,
    setup_guide text,
    playbook jsonb,
    validation_endpoint text,
    validation_method text DEFAULT 'GET'::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: integrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.integrations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    category text NOT NULL,
    key_name text NOT NULL,
    key_preview text,
    is_configured boolean DEFAULT false NOT NULL,
    agents_using text[] DEFAULT '{}'::text[] NOT NULL,
    added_by_agent text,
    description text,
    icon text DEFAULT '🔑'::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    integration_type text DEFAULT 'api_key'::text,
    credentials jsonb DEFAULT '[]'::jsonb,
    type text DEFAULT 'api'::text,
    template_id text,
    last_validated_at timestamp with time zone,
    last_validation_ok boolean,
    last_validation_error text,
    CONSTRAINT integrations_integration_type_check CHECK ((integration_type = ANY (ARRAY['api_key'::text, 'multi_key'::text, 'mcp'::text]))),
    CONSTRAINT integrations_type_check CHECK (((type IS NULL) OR (type = ANY (ARRAY['api'::text, 'mcp'::text]))))
);


--
-- Name: live_artifacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.live_artifacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid NOT NULL,
    agent_id text,
    title text NOT NULL,
    description text,
    html_content text NOT NULL,
    refresh_interval integer DEFAULT 30 NOT NULL,
    is_published boolean DEFAULT false NOT NULL,
    published_slug text,
    published_at timestamp with time zone,
    last_refreshed_at timestamp with time zone,
    view_count integer DEFAULT 0 NOT NULL,
    metadata jsonb,
    deleted_at timestamp with time zone,
    is_public boolean DEFAULT true NOT NULL,
    expires_at timestamp with time zone
);


--
-- Name: llm_provider_ops; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.llm_provider_ops (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    op text NOT NULL,
    provider_id text NOT NULL,
    payload jsonb,
    status text DEFAULT 'pending'::text NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    result jsonb,
    CONSTRAINT llm_provider_ops_op_check CHECK ((op = ANY (ARRAY['upsert_provider'::text, 'remove_provider'::text, 'discover_models'::text]))),
    CONSTRAINT llm_provider_ops_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'error'::text, 'done'::text])))
);


--
-- Name: message_reactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_reactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    message_id uuid NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    emoji text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: model_pricing; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_pricing (
    model text NOT NULL,
    input_per_1m numeric(12,4) NOT NULL,
    output_per_1m numeric(12,4) NOT NULL,
    cached_input_per_1m numeric(12,4),
    source text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    channel_id uuid,
    message_id uuid,
    author_name text NOT NULL,
    content_preview text DEFAULT ''::text NOT NULL,
    read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    agent_id text,
    CONSTRAINT notifications_channel_or_agent_chk CHECK (((channel_id IS NOT NULL) OR (agent_id IS NOT NULL)))
);


--
-- Name: onboarding_progress; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.onboarding_progress (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    current_step integer DEFAULT 1 NOT NULL,
    step_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    email text NOT NULL,
    full_name text DEFAULT ''::text,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    avatar_url text,
    last_seen_at timestamp with time zone,
    custom_status text,
    custom_status_emoji text,
    custom_status_set_at timestamp with time zone
);

ALTER TABLE ONLY public.profiles REPLICA IDENTITY FULL;


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: routine_phrases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.routine_phrases (
    cron_id text NOT NULL,
    agent_id text,
    nome text,
    impressao text NOT NULL,
    frase text NOT NULL,
    atualizado timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: setup_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.setup_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    seed_completed boolean DEFAULT false,
    seed_completed_at timestamp with time zone,
    onboarding_notified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.skills (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    description text,
    content text NOT NULL,
    source text DEFAULT 'manual'::text NOT NULL,
    source_url text,
    version text DEFAULT '1.0.0'::text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    sync_status text DEFAULT 'pending'::text NOT NULL,
    last_synced_at timestamp with time zone,
    CONSTRAINT skills_source_check CHECK ((source = ANY (ARRAY['clawhub'::text, 'git'::text, 'manual'::text, 'agent'::text]))),
    CONSTRAINT skills_sync_status_check CHECK ((sync_status = ANY (ARRAY['pending'::text, 'synced'::text, 'error'::text])))
);

ALTER TABLE ONLY public.skills REPLICA IDENTITY FULL;


--
-- Name: subagent_watch; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subagent_watch (
    child_key text NOT NULL,
    agent_id text NOT NULL,
    parent_session_key text NOT NULL,
    label text,
    status text DEFAULT 'running'::text NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    nudged_at timestamp with time zone,
    resolved_at timestamp with time zone
);


--
-- Name: suppressed_emails; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suppressed_emails (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    reason text NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT suppressed_emails_reason_check CHECK ((reason = ANY (ARRAY['unsubscribe'::text, 'bounce'::text, 'complaint'::text])))
);


--
-- Name: team_agents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_agents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    team_id uuid NOT NULL,
    agent_id text NOT NULL
);


--
-- Name: teams; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.teams (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text,
    color text DEFAULT ''::text,
    emoji text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: usage_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usage_events (
    id bigint NOT NULL,
    ts timestamp with time zone DEFAULT now() NOT NULL,
    agent_id text NOT NULL,
    model text,
    kind text NOT NULL,
    session_key text,
    label text,
    user_id uuid,
    input_tokens integer DEFAULT 0 NOT NULL,
    output_tokens integer DEFAULT 0 NOT NULL,
    cached_tokens integer DEFAULT 0 NOT NULL,
    total_tokens integer DEFAULT 0 NOT NULL,
    cost_usd numeric(12,6),
    source text NOT NULL,
    meta jsonb,
    external_id text,
    CONSTRAINT usage_events_kind_chk CHECK ((kind = ANY (ARRAY['dm'::text, 'channel'::text, 'cron'::text, 'subagent'::text, 'command'::text, 'unknown'::text]))),
    CONSTRAINT usage_events_source_chk CHECK ((source = ANY (ARRAY['turn'::text, 'session_delta'::text, 'trajectory'::text])))
);


--
-- Name: usage_by_agent_day; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.usage_by_agent_day WITH (security_invoker='true') AS
 SELECT date_trunc('day'::text, ts) AS dia,
    agent_id,
    sum(total_tokens) AS tokens,
    sum(input_tokens) AS input_tokens,
    sum(output_tokens) AS output_tokens,
    sum(cost_usd) AS custo_usd,
    count(*) AS eventos
   FROM public.usage_events
  GROUP BY (date_trunc('day'::text, ts)), agent_id;


--
-- Name: usage_by_model_day; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.usage_by_model_day WITH (security_invoker='true') AS
 SELECT date_trunc('day'::text, ts) AS dia,
    COALESCE(model, 'desconhecido'::text) AS model,
    sum(total_tokens) AS tokens,
    sum(cost_usd) AS custo_usd,
    count(*) AS eventos
   FROM public.usage_events
  GROUP BY (date_trunc('day'::text, ts)), COALESCE(model, 'desconhecido'::text);


--
-- Name: usage_by_task_day; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.usage_by_task_day WITH (security_invoker='true') AS
 SELECT date_trunc('day'::text, ts) AS dia,
    agent_id,
    kind,
    COALESCE(label, session_key, '(sem rotulo)'::text) AS tarefa,
    sum(total_tokens) AS tokens,
    sum(cost_usd) AS custo_usd,
    count(*) AS eventos
   FROM public.usage_events
  GROUP BY (date_trunc('day'::text, ts)), agent_id, kind, COALESCE(label, session_key, '(sem rotulo)'::text);


--
-- Name: usage_daily; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usage_daily (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    date date NOT NULL,
    messages_total integer DEFAULT 0,
    tokens_total integer DEFAULT 0,
    cost_total numeric DEFAULT 0,
    cache_hit_rate numeric DEFAULT 0,
    error_rate numeric DEFAULT 0,
    tool_calls integer DEFAULT 0,
    collected_at timestamp with time zone DEFAULT now()
);


--
-- Name: usage_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.usage_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: usage_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.usage_events_id_seq OWNED BY public.usage_events.id;


--
-- Name: usage_session_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usage_session_state (
    session_key text NOT NULL,
    agent_id text NOT NULL,
    last_tokens bigint DEFAULT 0 NOT NULL,
    last_cost_usd numeric(12,6) DEFAULT 0 NOT NULL,
    label text,
    model text,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role public.app_role DEFAULT 'user'::public.app_role NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: vps_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vps_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gateway_url text DEFAULT 'https://agentes.dnia.ai'::text NOT NULL,
    admin_token text DEFAULT ''::text NOT NULL,
    is_connected boolean DEFAULT false NOT NULL,
    last_ping timestamp with time zone,
    collector_version text,
    gateway_version text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: wiki_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wiki_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    space_id uuid NOT NULL,
    title text DEFAULT 'Sem título'::text NOT NULL,
    content text DEFAULT ''::text,
    created_by uuid NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_pinned boolean DEFAULT false NOT NULL,
    order_index integer DEFAULT 0 NOT NULL
);


--
-- Name: wiki_spaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wiki_spaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text,
    icon text DEFAULT '📘'::text,
    color text DEFAULT '#3D61FF'::text,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    order_index integer DEFAULT 0 NOT NULL,
    parent_id uuid
);


--
-- Name: usage_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_events ALTER COLUMN id SET DEFAULT nextval('public.usage_events_id_seq'::regclass);


--
-- Name: access_logs access_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_logs
    ADD CONSTRAINT access_logs_pkey PRIMARY KEY (id);


--
-- Name: agent_activity_log agent_activity_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_activity_log
    ADD CONSTRAINT agent_activity_log_pkey PRIMARY KEY (id);


--
-- Name: agent_activity agent_activity_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_activity
    ADD CONSTRAINT agent_activity_pkey PRIMARY KEY (id);


--
-- Name: agent_avatars agent_avatars_agent_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_avatars
    ADD CONSTRAINT agent_avatars_agent_id_key UNIQUE (agent_id);


--
-- Name: agent_avatars agent_avatars_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_avatars
    ADD CONSTRAINT agent_avatars_pkey PRIMARY KEY (id);


--
-- Name: agent_context_state agent_context_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_context_state
    ADD CONSTRAINT agent_context_state_pkey PRIMARY KEY (session_key);


--
-- Name: agent_creation_log agent_creation_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_creation_log
    ADD CONSTRAINT agent_creation_log_pkey PRIMARY KEY (id);


--
-- Name: agent_crons agent_crons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_crons
    ADD CONSTRAINT agent_crons_pkey PRIMARY KEY (id);


--
-- Name: agent_files agent_files_agent_id_file_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_files
    ADD CONSTRAINT agent_files_agent_id_file_name_key UNIQUE (agent_id, file_name);


--
-- Name: agent_files agent_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_files
    ADD CONSTRAINT agent_files_pkey PRIMARY KEY (id);


--
-- Name: agent_integrations agent_integrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_integrations
    ADD CONSTRAINT agent_integrations_pkey PRIMARY KEY (id);


--
-- Name: agent_profiles agent_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_profiles
    ADD CONSTRAINT agent_profiles_pkey PRIMARY KEY (agent_id);


--
-- Name: agent_results agent_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_results
    ADD CONSTRAINT agent_results_pkey PRIMARY KEY (id);


--
-- Name: agent_skills agent_skills_agent_id_skill_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_skills
    ADD CONSTRAINT agent_skills_agent_id_skill_id_key UNIQUE (agent_id, skill_id);


--
-- Name: agent_skills agent_skills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_skills
    ADD CONSTRAINT agent_skills_pkey PRIMARY KEY (id);


--
-- Name: agent_stats agent_stats_agent_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_stats
    ADD CONSTRAINT agent_stats_agent_id_key UNIQUE (agent_id);


--
-- Name: agent_stats agent_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_stats
    ADD CONSTRAINT agent_stats_pkey PRIMARY KEY (id);


--
-- Name: agent_tasks agent_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_tasks
    ADD CONSTRAINT agent_tasks_pkey PRIMARY KEY (id);


--
-- Name: agent_templates agent_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_templates
    ADD CONSTRAINT agent_templates_pkey PRIMARY KEY (agent_id);


--
-- Name: agent_token_snapshots agent_token_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_token_snapshots
    ADD CONSTRAINT agent_token_snapshots_pkey PRIMARY KEY (id);


--
-- Name: agent_turn_events agent_turn_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_turn_events
    ADD CONSTRAINT agent_turn_events_pkey PRIMARY KEY (id);


--
-- Name: agent_turns agent_turns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_turns
    ADD CONSTRAINT agent_turns_pkey PRIMARY KEY (id);


--
-- Name: agent_turns agent_turns_session_key_user_message_ts_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_turns
    ADD CONSTRAINT agent_turns_session_key_user_message_ts_key UNIQUE (session_key, user_message_ts);


--
-- Name: app_settings app_settings_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_key_key UNIQUE (key);


--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (id);


--
-- Name: arena_agents arena_agents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.arena_agents
    ADD CONSTRAINT arena_agents_pkey PRIMARY KEY (id);


--
-- Name: arena_messages arena_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.arena_messages
    ADD CONSTRAINT arena_messages_pkey PRIMARY KEY (id);


--
-- Name: arena_sessions arena_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.arena_sessions
    ADD CONSTRAINT arena_sessions_pkey PRIMARY KEY (id);


--
-- Name: arena_templates arena_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.arena_templates
    ADD CONSTRAINT arena_templates_pkey PRIMARY KEY (id);


--
-- Name: arenas arenas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.arenas
    ADD CONSTRAINT arenas_pkey PRIMARY KEY (id);


--
-- Name: artifact_titles artifact_titles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artifact_titles
    ADD CONSTRAINT artifact_titles_pkey PRIMARY KEY (id);


--
-- Name: artifact_titles artifact_titles_user_id_message_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artifact_titles
    ADD CONSTRAINT artifact_titles_user_id_message_id_key UNIQUE (user_id, message_id);


--
-- Name: artifacts_published artifacts_published_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artifacts_published
    ADD CONSTRAINT artifacts_published_pkey PRIMARY KEY (id);


--
-- Name: automation_runs automation_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_runs
    ADD CONSTRAINT automation_runs_pkey PRIMARY KEY (id);


--
-- Name: automations automations_name_agent_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automations
    ADD CONSTRAINT automations_name_agent_id_key UNIQUE (name, agent_id);


--
-- Name: automations automations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automations
    ADD CONSTRAINT automations_pkey PRIMARY KEY (id);


--
-- Name: branding branding_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.branding
    ADD CONSTRAINT branding_pkey PRIMARY KEY (id);


--
-- Name: channel_agent_activity channel_agent_activity_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_agent_activity
    ADD CONSTRAINT channel_agent_activity_pkey PRIMARY KEY (channel_id, agent_id);


--
-- Name: channel_members channel_members_channel_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_members
    ADD CONSTRAINT channel_members_channel_id_user_id_key UNIQUE (channel_id, user_id);


--
-- Name: channel_members channel_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_members
    ADD CONSTRAINT channel_members_pkey PRIMARY KEY (id);


--
-- Name: channel_messages channel_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_messages
    ADD CONSTRAINT channel_messages_pkey PRIMARY KEY (id);


--
-- Name: channels channels_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channels
    ADD CONSTRAINT channels_pkey PRIMARY KEY (id);


--
-- Name: company_profile company_profile_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.company_profile
    ADD CONSTRAINT company_profile_pkey PRIMARY KEY (id);


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: cron_jobs cron_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cron_jobs
    ADD CONSTRAINT cron_jobs_pkey PRIMARY KEY (id);


--
-- Name: dm_reads dm_reads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dm_reads
    ADD CONSTRAINT dm_reads_pkey PRIMARY KEY (channel_id, user_id);


--
-- Name: drafts drafts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drafts
    ADD CONSTRAINT drafts_pkey PRIMARY KEY (id);


--
-- Name: drafts drafts_user_id_draft_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.drafts
    ADD CONSTRAINT drafts_user_id_draft_key_key UNIQUE (user_id, draft_key);


--
-- Name: email_send_log email_send_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_send_log
    ADD CONSTRAINT email_send_log_pkey PRIMARY KEY (id);


--
-- Name: email_send_state email_send_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_send_state
    ADD CONSTRAINT email_send_state_pkey PRIMARY KEY (id);


--
-- Name: email_unsubscribe_tokens email_unsubscribe_tokens_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_unsubscribe_tokens
    ADD CONSTRAINT email_unsubscribe_tokens_email_key UNIQUE (email);


--
-- Name: email_unsubscribe_tokens email_unsubscribe_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_unsubscribe_tokens
    ADD CONSTRAINT email_unsubscribe_tokens_pkey PRIMARY KEY (id);


--
-- Name: email_unsubscribe_tokens email_unsubscribe_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_unsubscribe_tokens
    ADD CONSTRAINT email_unsubscribe_tokens_token_key UNIQUE (token);


--
-- Name: gateway_health gateway_health_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gateway_health
    ADD CONSTRAINT gateway_health_pkey PRIMARY KEY (id);


--
-- Name: generated_documents generated_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_documents
    ADD CONSTRAINT generated_documents_pkey PRIMARY KEY (id);


--
-- Name: integration_rate_limit integration_rate_limit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_rate_limit
    ADD CONSTRAINT integration_rate_limit_pkey PRIMARY KEY (user_id);


--
-- Name: integration_secrets integration_secrets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_secrets
    ADD CONSTRAINT integration_secrets_pkey PRIMARY KEY (name);


--
-- Name: integration_templates integration_templates_integration_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_templates
    ADD CONSTRAINT integration_templates_integration_type_key UNIQUE (integration_type);


--
-- Name: integration_templates integration_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_templates
    ADD CONSTRAINT integration_templates_pkey PRIMARY KEY (id);


--
-- Name: integrations integrations_key_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integrations
    ADD CONSTRAINT integrations_key_name_key UNIQUE (key_name);


--
-- Name: integrations integrations_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integrations
    ADD CONSTRAINT integrations_name_unique UNIQUE (name);


--
-- Name: integrations integrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integrations
    ADD CONSTRAINT integrations_pkey PRIMARY KEY (id);


--
-- Name: live_artifacts live_artifacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_artifacts
    ADD CONSTRAINT live_artifacts_pkey PRIMARY KEY (id);


--
-- Name: live_artifacts live_artifacts_published_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_artifacts
    ADD CONSTRAINT live_artifacts_published_slug_key UNIQUE (published_slug);


--
-- Name: llm_provider_ops llm_provider_ops_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.llm_provider_ops
    ADD CONSTRAINT llm_provider_ops_pkey PRIMARY KEY (id);


--
-- Name: message_reactions message_reactions_message_id_user_id_emoji_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reactions
    ADD CONSTRAINT message_reactions_message_id_user_id_emoji_key UNIQUE (message_id, user_id, emoji);


--
-- Name: message_reactions message_reactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reactions
    ADD CONSTRAINT message_reactions_pkey PRIMARY KEY (id);


--
-- Name: model_pricing model_pricing_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_pricing
    ADD CONSTRAINT model_pricing_pkey PRIMARY KEY (model);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: onboarding_progress onboarding_progress_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_progress
    ADD CONSTRAINT onboarding_progress_pkey PRIMARY KEY (id);


--
-- Name: onboarding_progress onboarding_progress_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_progress
    ADD CONSTRAINT onboarding_progress_user_id_key UNIQUE (user_id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: push_subscriptions push_subscriptions_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: routine_phrases routine_phrases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.routine_phrases
    ADD CONSTRAINT routine_phrases_pkey PRIMARY KEY (cron_id);


--
-- Name: setup_config setup_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.setup_config
    ADD CONSTRAINT setup_config_pkey PRIMARY KEY (id);


--
-- Name: skills skills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skills
    ADD CONSTRAINT skills_pkey PRIMARY KEY (id);


--
-- Name: skills skills_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.skills
    ADD CONSTRAINT skills_slug_key UNIQUE (slug);


--
-- Name: subagent_watch subagent_watch_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subagent_watch
    ADD CONSTRAINT subagent_watch_pkey PRIMARY KEY (child_key);


--
-- Name: suppressed_emails suppressed_emails_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppressed_emails
    ADD CONSTRAINT suppressed_emails_email_key UNIQUE (email);


--
-- Name: suppressed_emails suppressed_emails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppressed_emails
    ADD CONSTRAINT suppressed_emails_pkey PRIMARY KEY (id);


--
-- Name: team_agents team_agents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_agents
    ADD CONSTRAINT team_agents_pkey PRIMARY KEY (id);


--
-- Name: team_agents team_agents_team_id_agent_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_agents
    ADD CONSTRAINT team_agents_team_id_agent_id_key UNIQUE (team_id, agent_id);


--
-- Name: teams teams_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.teams
    ADD CONSTRAINT teams_pkey PRIMARY KEY (id);


--
-- Name: usage_daily usage_daily_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_daily
    ADD CONSTRAINT usage_daily_date_key UNIQUE (date);


--
-- Name: usage_daily usage_daily_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_daily
    ADD CONSTRAINT usage_daily_pkey PRIMARY KEY (id);


--
-- Name: usage_events usage_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_events
    ADD CONSTRAINT usage_events_pkey PRIMARY KEY (id);


--
-- Name: usage_session_state usage_session_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_session_state
    ADD CONSTRAINT usage_session_state_pkey PRIMARY KEY (session_key);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_user_id_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);


--
-- Name: vps_config vps_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vps_config
    ADD CONSTRAINT vps_config_pkey PRIMARY KEY (id);


--
-- Name: wiki_documents wiki_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_documents
    ADD CONSTRAINT wiki_documents_pkey PRIMARY KEY (id);


--
-- Name: wiki_spaces wiki_spaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_spaces
    ADD CONSTRAINT wiki_spaces_pkey PRIMARY KEY (id);


--
-- Name: agent_activity_agent_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_activity_agent_id_idx ON public.agent_activity USING btree (agent_id, created_at DESC);


--
-- Name: agent_activity_created_at_desc_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_activity_created_at_desc_idx ON public.agent_activity USING btree (created_at DESC);


--
-- Name: agent_activity_log_agent_timestamp_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_activity_log_agent_timestamp_idx ON public.agent_activity_log USING btree (agent_id, "timestamp" DESC);


--
-- Name: agent_activity_log_timestamp_desc_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_activity_log_timestamp_desc_idx ON public.agent_activity_log USING btree ("timestamp" DESC);


--
-- Name: agent_activity_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_activity_user_id_idx ON public.agent_activity USING btree (user_id, created_at DESC);


--
-- Name: agent_context_state_agent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_context_state_agent_idx ON public.agent_context_state USING btree (agent_id, updated_at DESC);


--
-- Name: agent_creation_log_agent_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_creation_log_agent_id_idx ON public.agent_creation_log USING btree (agent_id, created_at DESC);


--
-- Name: agent_files_pending_write_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_files_pending_write_idx ON public.agent_files USING btree (pending_write) WHERE pending_write;


--
-- Name: agent_profiles_openclaw_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX agent_profiles_openclaw_id_key ON public.agent_profiles USING btree (openclaw_id) WHERE (openclaw_id IS NOT NULL);


--
-- Name: agent_profiles_single_leader_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX agent_profiles_single_leader_idx ON public.agent_profiles USING btree ((true)) WHERE (is_leader = true);


--
-- Name: agent_skills_agent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_skills_agent_idx ON public.agent_skills USING btree (agent_id);


--
-- Name: agent_skills_puller_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_skills_puller_idx ON public.agent_skills USING btree (sync_status) WHERE (sync_status = ANY (ARRAY['pending'::text, 'removing'::text]));


--
-- Name: agent_skills_skill_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_skills_skill_idx ON public.agent_skills USING btree (skill_id);


--
-- Name: agent_tasks_agent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_tasks_agent_idx ON public.agent_tasks USING btree (agent_id, created_at DESC);


--
-- Name: agent_tasks_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_tasks_status_idx ON public.agent_tasks USING btree (status, created_at DESC) WHERE (status = ANY (ARRAY['running'::text, 'checkpoint'::text]));


--
-- Name: agent_token_snapshots_agent_snapshot_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX agent_token_snapshots_agent_snapshot_uniq ON public.agent_token_snapshots USING btree (agent_id, snapshot_at);


--
-- Name: agent_turn_events_breaker_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_turn_events_breaker_idx ON public.agent_turn_events USING btree (session_key, created_at) WHERE (acted = true);


--
-- Name: agent_turn_events_recent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_turn_events_recent_idx ON public.agent_turn_events USING btree (created_at);


--
-- Name: agent_turn_events_turn_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_turn_events_turn_idx ON public.agent_turn_events USING btree (turn_id, created_at);


--
-- Name: agent_turns_origem_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_turns_origem_idx ON public.agent_turns USING btree (origin_agent_id) WHERE ((origin_agent_id IS NOT NULL) AND (status = 'pending'::text));


--
-- Name: agent_turns_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_turns_pending_idx ON public.agent_turns USING btree (agent_id, user_id) WHERE (status = 'pending'::text);


--
-- Name: agent_turns_reconciler_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX agent_turns_reconciler_idx ON public.agent_turns USING btree (dispatched_at) WHERE (status = 'pending'::text);


--
-- Name: channel_agent_activity_vivas_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX channel_agent_activity_vivas_idx ON public.channel_agent_activity USING btree (channel_id) WHERE (finished_at IS NULL);


--
-- Name: company_profile_singleton; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX company_profile_singleton ON public.company_profile USING btree ((true));


--
-- Name: idx_agent_files_agent_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_files_agent_id ON public.agent_files USING btree (agent_id);


--
-- Name: idx_agent_profiles_is_leader; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_profiles_is_leader ON public.agent_profiles USING btree (is_leader) WHERE (is_leader = true);


--
-- Name: idx_agent_profiles_leader_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_profiles_leader_id ON public.agent_profiles USING btree (leader_id);


--
-- Name: idx_agent_profiles_official_order; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_profiles_official_order ON public.agent_profiles USING btree (is_official, sort_order, name);


--
-- Name: idx_agent_token_snapshots_agent_time; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_token_snapshots_agent_time ON public.agent_token_snapshots USING btree (agent_id, snapshot_at DESC);


--
-- Name: idx_automation_runs_automation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automation_runs_automation_id ON public.automation_runs USING btree (automation_id, started_at DESC);


--
-- Name: idx_automations_active_scheduled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automations_active_scheduled ON public.automations USING btree (type, is_active, scheduled_time) WHERE ((type = 'scheduled'::text) AND (is_active = true));


--
-- Name: idx_automations_active_trigger; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automations_active_trigger ON public.automations USING btree (type, trigger_event, is_active) WHERE ((type = 'trigger'::text) AND (is_active = true));


--
-- Name: idx_channel_members_member_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_channel_members_member_id ON public.channel_members USING btree (member_id);


--
-- Name: idx_channel_members_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_channel_members_user ON public.channel_members USING btree (user_id);


--
-- Name: idx_channel_messages_channel_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_channel_messages_channel_created ON public.channel_messages USING btree (channel_id, created_at DESC);


--
-- Name: idx_conversations_agent_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_agent_created ON public.conversations USING btree (agent_id, created_at);


--
-- Name: idx_conversations_user_agent_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_conversations_user_agent_created ON public.conversations USING btree (user_id, agent_id, created_at DESC);


--
-- Name: idx_drafts_user_id_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_drafts_user_id_updated_at ON public.drafts USING btree (user_id, updated_at DESC);


--
-- Name: idx_email_send_log_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_send_log_created ON public.email_send_log USING btree (created_at DESC);


--
-- Name: idx_email_send_log_message; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_send_log_message ON public.email_send_log USING btree (message_id);


--
-- Name: idx_email_send_log_message_sent_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_email_send_log_message_sent_unique ON public.email_send_log USING btree (message_id) WHERE (status = 'sent'::text);


--
-- Name: idx_email_send_log_recipient; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_send_log_recipient ON public.email_send_log USING btree (recipient_email);


--
-- Name: idx_generated_documents_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_generated_documents_user ON public.generated_documents USING btree (user_id, created_at DESC);


--
-- Name: idx_notifications_user_unread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_unread ON public.notifications USING btree (user_id, read) WHERE (read = false);


--
-- Name: idx_profiles_last_seen_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_last_seen_at ON public.profiles USING btree (last_seen_at);


--
-- Name: idx_push_subscriptions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_push_subscriptions_user_id ON public.push_subscriptions USING btree (user_id);


--
-- Name: idx_suppressed_emails_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_suppressed_emails_email ON public.suppressed_emails USING btree (email);


--
-- Name: idx_unsubscribe_tokens_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_unsubscribe_tokens_token ON public.email_unsubscribe_tokens USING btree (token);


--
-- Name: idx_wiki_documents_pinned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wiki_documents_pinned ON public.wiki_documents USING btree (space_id, is_pinned, order_index);


--
-- Name: idx_wiki_documents_space; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wiki_documents_space ON public.wiki_documents USING btree (space_id);


--
-- Name: idx_wiki_spaces_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wiki_spaces_parent ON public.wiki_spaces USING btree (parent_id);


--
-- Name: live_artifacts_active_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX live_artifacts_active_user_idx ON public.live_artifacts USING btree (user_id, updated_at DESC) WHERE (deleted_at IS NULL);


--
-- Name: live_artifacts_slug_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX live_artifacts_slug_idx ON public.live_artifacts USING btree (published_slug) WHERE (published_slug IS NOT NULL);


--
-- Name: live_artifacts_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX live_artifacts_user_idx ON public.live_artifacts USING btree (user_id, created_at DESC);


--
-- Name: llm_provider_ops_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX llm_provider_ops_pending_idx ON public.llm_provider_ops USING btree (created_at) WHERE (status = 'pending'::text);


--
-- Name: skills_slug_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skills_slug_idx ON public.skills USING btree (slug);


--
-- Name: skills_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX skills_source_idx ON public.skills USING btree (source);


--
-- Name: subagent_watch_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subagent_watch_open_idx ON public.subagent_watch USING btree (completed_at) WHERE (resolved_at IS NULL);


--
-- Name: usage_events_agent_ts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX usage_events_agent_ts_idx ON public.usage_events USING btree (agent_id, ts DESC);


--
-- Name: usage_events_external_id_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX usage_events_external_id_uidx ON public.usage_events USING btree (external_id);


--
-- Name: usage_events_kind_ts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX usage_events_kind_ts_idx ON public.usage_events USING btree (kind, ts DESC);


--
-- Name: usage_events_model_ts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX usage_events_model_ts_idx ON public.usage_events USING btree (model, ts DESC);


--
-- Name: usage_events_ts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX usage_events_ts_idx ON public.usage_events USING btree (ts DESC);


--
-- Name: usage_session_state_agent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX usage_session_state_agent_idx ON public.usage_session_state USING btree (agent_id);


--
-- Name: agent_activity agent_activity_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER agent_activity_set_updated_at BEFORE UPDATE ON public.agent_activity FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: agent_tasks agent_tasks_post_completion; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER agent_tasks_post_completion AFTER UPDATE OF status ON public.agent_tasks FOR EACH ROW WHEN (((new.status = 'done'::text) AND (old.status IS DISTINCT FROM 'done'::text))) EXECUTE FUNCTION public.post_task_completion_to_chat();


--
-- Name: agent_tasks agent_tasks_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER agent_tasks_updated_at BEFORE UPDATE ON public.agent_tasks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: agent_templates agent_templates_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER agent_templates_set_updated_at BEFORE UPDATE ON public.agent_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: channel_messages channel_messages_dedup_guard_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER channel_messages_dedup_guard_trg BEFORE INSERT ON public.channel_messages FOR EACH ROW EXECUTE FUNCTION public.channel_messages_dedup_guard();


--
-- Name: company_profile company_profile_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER company_profile_updated_at BEFORE UPDATE ON public.company_profile FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: conversations conversations_mark_turn_delivered; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER conversations_mark_turn_delivered AFTER INSERT ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.mark_agent_turn_delivered();


--
-- Name: integration_templates integration_templates_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER integration_templates_updated_at BEFORE UPDATE ON public.integration_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: integrations integrations_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER integrations_set_updated_at BEFORE UPDATE ON public.integrations FOR EACH ROW EXECUTE FUNCTION public.moddatetime('updated_at');


--
-- Name: notifications notifications_send_push; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER notifications_send_push AFTER INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.trigger_send_push_on_notification();


--
-- Name: agent_profiles set_agent_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_agent_profiles_updated_at BEFORE UPDATE ON public.agent_profiles FOR EACH ROW EXECUTE FUNCTION public.moddatetime('updated_at');


--
-- Name: drafts set_drafts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_drafts_updated_at BEFORE UPDATE ON public.drafts FOR EACH ROW EXECUTE FUNCTION public.set_drafts_updated_at();


--
-- Name: skills skills_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER skills_updated_at BEFORE UPDATE ON public.skills FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: channel_members sync_channel_members_rest_fields_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER sync_channel_members_rest_fields_trigger BEFORE INSERT OR UPDATE ON public.channel_members FOR EACH ROW EXECUTE FUNCTION public.sync_channel_members_rest_fields();


--
-- Name: automations trg_automations_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_automations_updated_at BEFORE UPDATE ON public.automations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: wiki_documents trg_wiki_documents_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_wiki_documents_updated_at BEFORE UPDATE ON public.wiki_documents FOR EACH ROW EXECUTE FUNCTION public.wiki_documents_set_updated_at();


--
-- Name: artifact_titles update_artifact_titles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_artifact_titles_updated_at BEFORE UPDATE ON public.artifact_titles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: integration_secrets update_integration_secrets_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_integration_secrets_updated_at BEFORE UPDATE ON public.integration_secrets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: live_artifacts update_live_artifacts_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_live_artifacts_updated_at BEFORE UPDATE ON public.live_artifacts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: onboarding_progress update_onboarding_progress_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_onboarding_progress_updated_at BEFORE UPDATE ON public.onboarding_progress FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: vps_config update_vps_config_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_vps_config_updated_at BEFORE UPDATE ON public.vps_config FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: access_logs access_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.access_logs
    ADD CONSTRAINT access_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: agent_creation_log agent_creation_log_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_creation_log
    ADD CONSTRAINT agent_creation_log_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: agent_integrations agent_integrations_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_integrations
    ADD CONSTRAINT agent_integrations_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agent_profiles(agent_id) ON DELETE CASCADE;


--
-- Name: agent_profiles agent_profiles_leader_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_profiles
    ADD CONSTRAINT agent_profiles_leader_id_fkey FOREIGN KEY (leader_id) REFERENCES public.agent_profiles(agent_id) ON DELETE SET NULL;


--
-- Name: agent_skills agent_skills_skill_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_skills
    ADD CONSTRAINT agent_skills_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES public.skills(id) ON DELETE CASCADE;


--
-- Name: agent_tasks agent_tasks_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_tasks
    ADD CONSTRAINT agent_tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: agent_turn_events agent_turn_events_turn_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_turn_events
    ADD CONSTRAINT agent_turn_events_turn_id_fkey FOREIGN KEY (turn_id) REFERENCES public.agent_turns(id) ON DELETE CASCADE;


--
-- Name: arena_agents arena_agents_arena_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.arena_agents
    ADD CONSTRAINT arena_agents_arena_id_fkey FOREIGN KEY (arena_id) REFERENCES public.arenas(id) ON DELETE CASCADE;


--
-- Name: arena_messages arena_messages_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.arena_messages
    ADD CONSTRAINT arena_messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.arena_sessions(id) ON DELETE CASCADE;


--
-- Name: arena_sessions arena_sessions_arena_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.arena_sessions
    ADD CONSTRAINT arena_sessions_arena_id_fkey FOREIGN KEY (arena_id) REFERENCES public.arenas(id) ON DELETE CASCADE;


--
-- Name: arena_sessions arena_sessions_parent_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.arena_sessions
    ADD CONSTRAINT arena_sessions_parent_session_id_fkey FOREIGN KEY (parent_session_id) REFERENCES public.arena_sessions(id) ON DELETE SET NULL;


--
-- Name: arenas arenas_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.arenas
    ADD CONSTRAINT arenas_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: artifact_titles artifact_titles_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artifact_titles
    ADD CONSTRAINT artifact_titles_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: artifact_titles artifact_titles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artifact_titles
    ADD CONSTRAINT artifact_titles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: automation_runs automation_runs_automation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_runs
    ADD CONSTRAINT automation_runs_automation_id_fkey FOREIGN KEY (automation_id) REFERENCES public.automations(id) ON DELETE CASCADE;


--
-- Name: automations automations_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automations
    ADD CONSTRAINT automations_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agent_profiles(agent_id) ON DELETE CASCADE;


--
-- Name: automations automations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automations
    ADD CONSTRAINT automations_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);


--
-- Name: channel_agent_activity channel_agent_activity_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_agent_activity
    ADD CONSTRAINT channel_agent_activity_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE;


--
-- Name: channel_members channel_members_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_members
    ADD CONSTRAINT channel_members_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE;


--
-- Name: channel_messages channel_messages_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_messages
    ADD CONSTRAINT channel_messages_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE;


--
-- Name: channel_messages channel_messages_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.channel_messages
    ADD CONSTRAINT channel_messages_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.channel_messages(id) ON DELETE SET NULL;


--
-- Name: generated_documents generated_documents_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_documents
    ADD CONSTRAINT generated_documents_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: live_artifacts live_artifacts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.live_artifacts
    ADD CONSTRAINT live_artifacts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: message_reactions message_reactions_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_reactions
    ADD CONSTRAINT message_reactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.channel_messages(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_channel_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES public.channels(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.channel_messages(id) ON DELETE CASCADE;


--
-- Name: onboarding_progress onboarding_progress_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_progress
    ADD CONSTRAINT onboarding_progress_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: team_agents team_agents_team_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_agents
    ADD CONSTRAINT team_agents_team_id_fkey FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: wiki_documents wiki_documents_space_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_documents
    ADD CONSTRAINT wiki_documents_space_id_fkey FOREIGN KEY (space_id) REFERENCES public.wiki_spaces(id) ON DELETE CASCADE;


--
-- Name: wiki_spaces wiki_spaces_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_spaces
    ADD CONSTRAINT wiki_spaces_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.wiki_spaces(id) ON DELETE CASCADE;


--
-- Name: artifacts_published Anyone can view public artifacts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can view public artifacts" ON public.artifacts_published FOR SELECT USING ((is_public = true));


--
-- Name: agent_context_state Autenticados leem contexto; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Autenticados leem contexto" ON public.agent_context_state FOR SELECT TO authenticated USING (true);


--
-- Name: model_pricing Autenticados leem precos; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Autenticados leem precos" ON public.model_pricing FOR SELECT TO authenticated USING (true);


--
-- Name: usage_events Autenticados leem uso; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Autenticados leem uso" ON public.usage_events FOR SELECT TO authenticated USING (true);


--
-- Name: wiki_documents Auth insert docs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Auth insert docs" ON public.wiki_documents FOR INSERT TO authenticated WITH CHECK ((created_by = auth.uid()));


--
-- Name: wiki_spaces Auth insert spaces; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Auth insert spaces" ON public.wiki_spaces FOR INSERT TO authenticated WITH CHECK ((created_by = auth.uid()));


--
-- Name: wiki_documents Auth read docs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Auth read docs" ON public.wiki_documents FOR SELECT TO authenticated USING (true);


--
-- Name: wiki_spaces Auth read spaces; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Auth read spaces" ON public.wiki_spaces FOR SELECT TO authenticated USING (true);


--
-- Name: wiki_documents Auth update docs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Auth update docs" ON public.wiki_documents FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: wiki_spaces Auth update spaces; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Auth update spaces" ON public.wiki_spaces FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: integration_templates Authenticated can read integration templates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated can read integration templates" ON public.integration_templates FOR SELECT TO authenticated USING (true);


--
-- Name: integrations Authenticated can view integrations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated can view integrations" ON public.integrations FOR SELECT TO authenticated USING (true);


--
-- Name: agent_avatars Authenticated delete agent_avatars; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated delete agent_avatars" ON public.agent_avatars FOR DELETE TO authenticated USING (true);


--
-- Name: agent_results Authenticated delete agent_results; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated delete agent_results" ON public.agent_results FOR DELETE TO authenticated USING (true);


--
-- Name: access_logs Authenticated insert logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated insert logs" ON public.access_logs FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: agent_avatars Authenticated read agent_avatars; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated read agent_avatars" ON public.agent_avatars FOR SELECT TO authenticated USING (true);


--
-- Name: agent_crons Authenticated read agent_crons; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated read agent_crons" ON public.agent_crons FOR SELECT TO authenticated USING (true);


--
-- Name: agent_files Authenticated read agent_files; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated read agent_files" ON public.agent_files FOR SELECT TO authenticated USING (true);


--
-- Name: agent_profiles Authenticated read agent_profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated read agent_profiles" ON public.agent_profiles FOR SELECT TO authenticated USING (true);


--
-- Name: agent_results Authenticated read agent_results; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated read agent_results" ON public.agent_results FOR SELECT TO authenticated USING (true);


--
-- Name: arena_agents Authenticated read arena_agents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated read arena_agents" ON public.arena_agents FOR SELECT TO authenticated USING (true);


--
-- Name: arena_messages Authenticated read arena_messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated read arena_messages" ON public.arena_messages FOR SELECT TO authenticated USING (true);


--
-- Name: arena_sessions Authenticated read arena_sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated read arena_sessions" ON public.arena_sessions FOR SELECT TO authenticated USING (true);


--
-- Name: arena_templates Authenticated read arena_templates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated read arena_templates" ON public.arena_templates FOR SELECT TO authenticated USING (true);


--
-- Name: arenas Authenticated read arenas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated read arenas" ON public.arenas FOR SELECT TO authenticated USING (true);


--
-- Name: team_agents Authenticated read team_agents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated read team_agents" ON public.team_agents FOR SELECT TO authenticated USING (true);


--
-- Name: teams Authenticated read teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated read teams" ON public.teams FOR SELECT TO authenticated USING (true);


--
-- Name: agent_token_snapshots Authenticated reads agent_token_snapshots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated reads agent_token_snapshots" ON public.agent_token_snapshots FOR SELECT TO authenticated USING (true);


--
-- Name: agent_avatars Authenticated update agent_avatars; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated update agent_avatars" ON public.agent_avatars FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: agent_results Authenticated update agent_results; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated update agent_results" ON public.agent_results FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: arena_agents Authenticated update arena_agents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated update arena_agents" ON public.arena_agents FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: arena_messages Authenticated update arena_messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated update arena_messages" ON public.arena_messages FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: arena_sessions Authenticated update arena_sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated update arena_sessions" ON public.arena_sessions FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: arenas Authenticated update arenas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated update arenas" ON public.arenas FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: agent_activity_log Authenticated users can read agent activity; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can read agent activity" ON public.agent_activity_log FOR SELECT TO authenticated USING (true);


--
-- Name: agent_activity Authenticated users can read agent activity records; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can read agent activity records" ON public.agent_activity FOR SELECT TO authenticated USING (true);


--
-- Name: channels Authenticated users create channels; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users create channels" ON public.channels FOR INSERT TO authenticated WITH CHECK ((created_by = auth.uid()));


--
-- Name: agent_stats Authenticated users read agent_stats; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users read agent_stats" ON public.agent_stats FOR SELECT TO authenticated USING (true);


--
-- Name: profiles Authenticated users read all profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users read all profiles" ON public.profiles FOR SELECT TO authenticated USING (true);


--
-- Name: cron_jobs Authenticated users read cron_jobs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users read cron_jobs" ON public.cron_jobs FOR SELECT TO authenticated USING (true);


--
-- Name: gateway_health Authenticated users read gateway_health; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users read gateway_health" ON public.gateway_health FOR SELECT TO authenticated USING (true);


--
-- Name: message_reactions Authenticated users read reactions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users read reactions" ON public.message_reactions FOR SELECT TO authenticated USING (true);


--
-- Name: usage_daily Authenticated users read usage_daily; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users read usage_daily" ON public.usage_daily FOR SELECT TO authenticated USING (true);


--
-- Name: agent_avatars Authenticated write agent_avatars; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated write agent_avatars" ON public.agent_avatars FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: agent_results Authenticated write agent_results; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated write agent_results" ON public.agent_results FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: arena_agents Authenticated write arena_agents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated write arena_agents" ON public.arena_agents FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: arena_messages Authenticated write arena_messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated write arena_messages" ON public.arena_messages FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: arena_sessions Authenticated write arena_sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated write arena_sessions" ON public.arena_sessions FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: arenas Authenticated write arenas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated write arenas" ON public.arenas FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: channel_messages Author can update own messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Author can update own messages" ON public.channel_messages FOR UPDATE TO authenticated USING ((author_id = (auth.uid())::text)) WITH CHECK ((author_id = (auth.uid())::text));


--
-- Name: channels Channel creator or admin can delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Channel creator or admin can delete" ON public.channels FOR DELETE TO authenticated USING (((created_by = auth.uid()) OR public.has_role(auth.uid(), 'super_admin'::public.app_role)));


--
-- Name: channels Channel creator or admin can update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Channel creator or admin can update" ON public.channels FOR UPDATE TO authenticated USING (((created_by = auth.uid()) OR public.has_role(auth.uid(), 'super_admin'::public.app_role)));


--
-- Name: channel_members Channel managers remove members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Channel managers remove members" ON public.channel_members FOR DELETE TO authenticated USING (((user_id = (auth.uid())::text) OR (EXISTS ( SELECT 1
   FROM public.channels c
  WHERE ((c.id = channel_members.channel_id) AND ((c.created_by = auth.uid()) OR public.has_role(auth.uid(), 'super_admin'::public.app_role)))))));


--
-- Name: notifications Channel members can notify other members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Channel members can notify other members" ON public.notifications FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) OR ((channel_id IS NOT NULL) AND public.is_channel_member(channel_id, (auth.uid())::text) AND public.is_channel_member(channel_id, (user_id)::text))));


--
-- Name: wiki_documents Creator or admin delete docs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Creator or admin delete docs" ON public.wiki_documents FOR DELETE TO authenticated USING (((created_by = auth.uid()) OR public.has_role(auth.uid(), 'super_admin'::public.app_role)));


--
-- Name: wiki_spaces Creator or admin delete spaces; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Creator or admin delete spaces" ON public.wiki_spaces FOR DELETE TO authenticated USING (((created_by = auth.uid()) OR public.has_role(auth.uid(), 'super_admin'::public.app_role)));


--
-- Name: dm_reads Members read dm_reads; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Members read dm_reads" ON public.dm_reads FOR SELECT TO authenticated USING (public.is_channel_member(channel_id, (auth.uid())::text));


--
-- Name: agent_avatars Public read agent_avatars; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public read agent_avatars" ON public.agent_avatars FOR SELECT TO anon USING (true);


--
-- Name: branding Public read branding; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Public read branding" ON public.branding FOR SELECT TO authenticated, anon USING (true);


--
-- Name: channel_members See channel members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "See channel members" ON public.channel_members FOR SELECT TO authenticated USING ((public.is_public_channel(channel_id) OR public.is_channel_member(channel_id, (auth.uid())::text)));


--
-- Name: channel_messages See channel messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "See channel messages" ON public.channel_messages FOR SELECT TO authenticated USING ((public.is_public_channel(channel_id) OR public.is_channel_member(channel_id, (auth.uid())::text)));


--
-- Name: channel_messages Send channel messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Send channel messages" ON public.channel_messages FOR INSERT TO authenticated WITH CHECK (public.is_channel_member(channel_id, (auth.uid())::text));


--
-- Name: channel_messages Service role can delete messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can delete messages" ON public.channel_messages FOR DELETE USING ((auth.role() = 'service_role'::text));


--
-- Name: conversations Service role can insert conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can insert conversations" ON public.conversations FOR INSERT WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: notifications Service role can insert notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can insert notifications" ON public.notifications FOR INSERT WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: email_send_log Service role can insert send log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can insert send log" ON public.email_send_log FOR INSERT WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: suppressed_emails Service role can insert suppressed emails; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can insert suppressed emails" ON public.suppressed_emails FOR INSERT WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: email_unsubscribe_tokens Service role can insert tokens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can insert tokens" ON public.email_unsubscribe_tokens FOR INSERT WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: email_send_state Service role can manage send state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can manage send state" ON public.email_send_state USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: email_unsubscribe_tokens Service role can mark tokens as used; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can mark tokens as used" ON public.email_unsubscribe_tokens FOR UPDATE USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: email_send_log Service role can read send log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can read send log" ON public.email_send_log FOR SELECT USING ((auth.role() = 'service_role'::text));


--
-- Name: suppressed_emails Service role can read suppressed emails; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can read suppressed emails" ON public.suppressed_emails FOR SELECT USING ((auth.role() = 'service_role'::text));


--
-- Name: email_unsubscribe_tokens Service role can read tokens; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can read tokens" ON public.email_unsubscribe_tokens FOR SELECT USING ((auth.role() = 'service_role'::text));


--
-- Name: email_send_log Service role can update send log; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role can update send log" ON public.email_send_log FOR UPDATE USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: agent_files Service role manages agent_files; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role manages agent_files" ON public.agent_files USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: agent_stats Service role manages agent_stats; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role manages agent_stats" ON public.agent_stats USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: agent_token_snapshots Service role manages agent_token_snapshots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role manages agent_token_snapshots" ON public.agent_token_snapshots USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: cron_jobs Service role manages cron_jobs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role manages cron_jobs" ON public.cron_jobs USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: gateway_health Service role manages gateway_health; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role manages gateway_health" ON public.gateway_health USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: push_subscriptions Service role manages push subscriptions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role manages push subscriptions" ON public.push_subscriptions USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: usage_daily Service role manages usage_daily; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role manages usage_daily" ON public.usage_daily USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: channel_members Service role reads channel members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Service role reads channel members" ON public.channel_members FOR SELECT USING ((auth.role() = 'service_role'::text));


--
-- Name: agent_crons Super admin delete agent_crons; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admin delete agent_crons" ON public.agent_crons FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: app_settings Super admin delete app_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admin delete app_settings" ON public.app_settings FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: arena_agents Super admin delete arena_agents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admin delete arena_agents" ON public.arena_agents FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: arena_messages Super admin delete arena_messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admin delete arena_messages" ON public.arena_messages FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: arena_sessions Super admin delete arena_sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admin delete arena_sessions" ON public.arena_sessions FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: arena_templates Super admin delete arena_templates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admin delete arena_templates" ON public.arena_templates FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: arenas Super admin delete arenas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admin delete arenas" ON public.arenas FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: branding Super admin delete branding; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admin delete branding" ON public.branding FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: team_agents Super admin delete team_agents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admin delete team_agents" ON public.team_agents FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: teams Super admin delete teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admin delete teams" ON public.teams FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: agent_crons Super admin insert agent_crons; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admin insert agent_crons" ON public.agent_crons FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: app_settings Super admin insert app_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admin insert app_settings" ON public.app_settings FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: arena_templates Super admin insert arena_templates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admin insert arena_templates" ON public.arena_templates FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: branding Super admin insert branding; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admin insert branding" ON public.branding FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: team_agents Super admin insert team_agents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admin insert team_agents" ON public.team_agents FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: teams Super admin insert teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admin insert teams" ON public.teams FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: agent_files Super admin manages agent_files; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admin manages agent_files" ON public.agent_files TO authenticated USING (public.has_role(auth.uid(), 'super_admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: agent_integrations Super admin manages agent_integrations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admin manages agent_integrations" ON public.agent_integrations TO authenticated USING (public.has_role(auth.uid(), 'super_admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: agent_profiles Super admin manages agent_profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admin manages agent_profiles" ON public.agent_profiles TO authenticated USING (public.has_role(auth.uid(), 'super_admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: profiles Super admin manages profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admin manages profiles" ON public.profiles TO authenticated USING (public.has_role(auth.uid(), 'super_admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: user_roles Super admin manages roles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admin manages roles" ON public.user_roles TO authenticated USING (public.has_role(auth.uid(), 'super_admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: app_settings Super admin read app_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admin read app_settings" ON public.app_settings FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: agent_integrations Super admin reads agent_integrations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admin reads agent_integrations" ON public.agent_integrations FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: agent_token_snapshots Super admin reads agent_token_snapshots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admin reads agent_token_snapshots" ON public.agent_token_snapshots FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: access_logs Super admin reads logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admin reads logs" ON public.access_logs FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: agent_crons Super admin update agent_crons; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admin update agent_crons" ON public.agent_crons FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'super_admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: app_settings Super admin update app_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admin update app_settings" ON public.app_settings FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'super_admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: arena_templates Super admin update arena_templates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admin update arena_templates" ON public.arena_templates FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'super_admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: branding Super admin update branding; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admin update branding" ON public.branding FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'super_admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: team_agents Super admin update team_agents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admin update team_agents" ON public.team_agents FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'super_admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: teams Super admin update teams; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admin update teams" ON public.teams FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'super_admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: integrations Super admins can delete integrations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins can delete integrations" ON public.integrations FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: integrations Super admins can insert integrations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins can insert integrations" ON public.integrations FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: integrations Super admins can update integrations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins can update integrations" ON public.integrations FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'super_admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: integration_templates Super admins manage integration templates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Super admins manage integration templates" ON public.integration_templates TO authenticated USING (public.has_role(auth.uid(), 'super_admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: onboarding_progress Users can delete their own onboarding progress; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete their own onboarding progress" ON public.onboarding_progress FOR DELETE TO authenticated USING ((auth.uid() = user_id));


--
-- Name: onboarding_progress Users can insert their own onboarding progress; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert their own onboarding progress" ON public.onboarding_progress FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));


--
-- Name: artifact_titles Users can manage their own artifact titles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can manage their own artifact titles" ON public.artifact_titles TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: onboarding_progress Users can update their own onboarding progress; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update their own onboarding progress" ON public.onboarding_progress FOR UPDATE TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: onboarding_progress Users can view their own onboarding progress; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own onboarding progress" ON public.onboarding_progress FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: artifacts_published Users delete own artifacts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users delete own artifacts" ON public.artifacts_published FOR DELETE TO authenticated USING ((created_by = auth.uid()));


--
-- Name: conversations Users delete own conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users delete own conversations" ON public.conversations FOR DELETE TO authenticated USING ((user_id = auth.uid()));


--
-- Name: drafts Users delete own drafts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users delete own drafts" ON public.drafts FOR DELETE TO authenticated USING ((user_id = auth.uid()));


--
-- Name: push_subscriptions Users delete own push subscriptions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users delete own push subscriptions" ON public.push_subscriptions FOR DELETE TO authenticated USING ((user_id = auth.uid()));


--
-- Name: message_reactions Users delete own reactions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users delete own reactions" ON public.message_reactions FOR DELETE TO authenticated USING ((user_id = auth.uid()));


--
-- Name: artifacts_published Users insert own artifacts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users insert own artifacts" ON public.artifacts_published FOR INSERT TO authenticated WITH CHECK ((created_by = auth.uid()));


--
-- Name: conversations Users insert own conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users insert own conversations" ON public.conversations FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: dm_reads Users insert own dm_reads; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users insert own dm_reads" ON public.dm_reads FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) AND public.is_channel_member(channel_id, (auth.uid())::text)));


--
-- Name: drafts Users insert own drafts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users insert own drafts" ON public.drafts FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: push_subscriptions Users insert own push subscriptions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users insert own push subscriptions" ON public.push_subscriptions FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: message_reactions Users insert own reactions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users insert own reactions" ON public.message_reactions FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));


--
-- Name: channel_members Users join allowed channels; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users join allowed channels" ON public.channel_members FOR INSERT TO authenticated WITH CHECK ((((user_id = (auth.uid())::text) AND public.is_public_channel(channel_id)) OR (EXISTS ( SELECT 1
   FROM public.channels c
  WHERE ((c.id = channel_members.channel_id) AND ((c.created_by = auth.uid()) OR public.has_role(auth.uid(), 'super_admin'::public.app_role)))))));


--
-- Name: drafts Users read own drafts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users read own drafts" ON public.drafts FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: notifications Users read own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users read own notifications" ON public.notifications FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: profiles Users read own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users read own profile" ON public.profiles FOR SELECT TO authenticated USING (((id = auth.uid()) OR public.has_role(auth.uid(), 'super_admin'::public.app_role)));


--
-- Name: push_subscriptions Users read own push subscriptions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users read own push subscriptions" ON public.push_subscriptions FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: user_roles Users read own role; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users read own role" ON public.user_roles FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: channels Users see accessible channels; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users see accessible channels" ON public.channels FOR SELECT TO authenticated USING (((type = 'public'::public.channel_type) OR (created_by = auth.uid()) OR public.is_channel_member(id, (auth.uid())::text)));


--
-- Name: conversations Users see own conversations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users see own conversations" ON public.conversations FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: artifacts_published Users update own artifacts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users update own artifacts" ON public.artifacts_published FOR UPDATE TO authenticated USING ((created_by = auth.uid())) WITH CHECK ((created_by = auth.uid()));


--
-- Name: dm_reads Users update own dm_reads; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users update own dm_reads" ON public.dm_reads FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: drafts Users update own drafts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users update own drafts" ON public.drafts FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: notifications Users update own notifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users update own notifications" ON public.notifications FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: profiles Users update own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING ((id = auth.uid())) WITH CHECK ((id = auth.uid()));


--
-- Name: push_subscriptions Users update own push subscriptions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users update own push subscriptions" ON public.push_subscriptions FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));


--
-- Name: artifacts_published Users view own artifacts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users view own artifacts" ON public.artifacts_published FOR SELECT TO authenticated USING ((created_by = auth.uid()));


--
-- Name: access_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.access_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: company_profile admin_all_company_profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_all_company_profile ON public.company_profile TO authenticated USING (public.has_role(auth.uid(), 'super_admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: agent_activity; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_activity ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_activity_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_activity_log ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_avatars; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_avatars ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_context_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_context_state ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_creation_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_creation_log ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_crons; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_crons ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_files; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_files ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_integrations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_integrations ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_results; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_results ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_skills; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_skills ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_skills agent_skills_authenticated_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agent_skills_authenticated_read ON public.agent_skills FOR SELECT TO authenticated USING (true);


--
-- Name: agent_stats; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_stats ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_templates agent_templates readable by everyone; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "agent_templates readable by everyone" ON public.agent_templates FOR SELECT USING (true);


--
-- Name: agent_templates agent_templates writable by super_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "agent_templates writable by super_admin" ON public.agent_templates TO authenticated USING (public.has_role(auth.uid(), 'super_admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: agent_token_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_token_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_turn_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_turn_events ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_turns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_turns ENABLE ROW LEVEL SECURITY;

--
-- Name: app_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: arena_agents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.arena_agents ENABLE ROW LEVEL SECURITY;

--
-- Name: arena_agents arena_agents_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY arena_agents_delete ON public.arena_agents FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.arenas a
  WHERE ((a.id = arena_agents.arena_id) AND (a.created_by = auth.uid())))));


--
-- Name: arena_agents arena_agents_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY arena_agents_insert ON public.arena_agents FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.arenas a
  WHERE ((a.id = arena_agents.arena_id) AND (a.created_by = auth.uid())))));


--
-- Name: arena_agents arena_agents_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY arena_agents_select ON public.arena_agents FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.arenas a
  WHERE ((a.id = arena_agents.arena_id) AND (a.created_by = auth.uid())))));


--
-- Name: arena_agents arena_agents_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY arena_agents_update ON public.arena_agents FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.arenas a
  WHERE ((a.id = arena_agents.arena_id) AND (a.created_by = auth.uid())))));


--
-- Name: arena_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.arena_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: arena_messages arena_messages_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY arena_messages_delete ON public.arena_messages FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.arena_sessions s
     JOIN public.arenas a ON ((a.id = s.arena_id)))
  WHERE ((s.id = arena_messages.session_id) AND (a.created_by = auth.uid())))));


--
-- Name: arena_messages arena_messages_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY arena_messages_insert ON public.arena_messages FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.arena_sessions s
     JOIN public.arenas a ON ((a.id = s.arena_id)))
  WHERE ((s.id = arena_messages.session_id) AND (a.created_by = auth.uid())))));


--
-- Name: arena_messages arena_messages_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY arena_messages_select ON public.arena_messages FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.arena_sessions s
     JOIN public.arenas a ON ((a.id = s.arena_id)))
  WHERE ((s.id = arena_messages.session_id) AND (a.created_by = auth.uid())))));


--
-- Name: arena_messages arena_messages_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY arena_messages_update ON public.arena_messages FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM (public.arena_sessions s
     JOIN public.arenas a ON ((a.id = s.arena_id)))
  WHERE ((s.id = arena_messages.session_id) AND (a.created_by = auth.uid())))));


--
-- Name: arena_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.arena_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: arena_sessions arena_sessions_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY arena_sessions_delete ON public.arena_sessions FOR DELETE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.arenas a
  WHERE ((a.id = arena_sessions.arena_id) AND (a.created_by = auth.uid())))));


--
-- Name: arena_sessions arena_sessions_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY arena_sessions_insert ON public.arena_sessions FOR INSERT TO authenticated WITH CHECK ((EXISTS ( SELECT 1
   FROM public.arenas a
  WHERE ((a.id = arena_sessions.arena_id) AND (a.created_by = auth.uid())))));


--
-- Name: arena_sessions arena_sessions_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY arena_sessions_select ON public.arena_sessions FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.arenas a
  WHERE ((a.id = arena_sessions.arena_id) AND (a.created_by = auth.uid())))));


--
-- Name: arena_sessions arena_sessions_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY arena_sessions_update ON public.arena_sessions FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.arenas a
  WHERE ((a.id = arena_sessions.arena_id) AND (a.created_by = auth.uid())))));


--
-- Name: arena_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.arena_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: arena_templates arena_templates_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY arena_templates_select ON public.arena_templates FOR SELECT TO authenticated USING (true);


--
-- Name: arenas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.arenas ENABLE ROW LEVEL SECURITY;

--
-- Name: arenas arenas_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY arenas_delete ON public.arenas FOR DELETE TO authenticated USING ((created_by = auth.uid()));


--
-- Name: arenas arenas_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY arenas_insert ON public.arenas FOR INSERT TO authenticated WITH CHECK ((created_by = auth.uid()));


--
-- Name: arenas arenas_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY arenas_select ON public.arenas FOR SELECT TO authenticated USING ((created_by = auth.uid()));


--
-- Name: arenas arenas_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY arenas_update ON public.arenas FOR UPDATE TO authenticated USING ((created_by = auth.uid())) WITH CHECK ((created_by = auth.uid()));


--
-- Name: artifact_titles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.artifact_titles ENABLE ROW LEVEL SECURITY;

--
-- Name: artifacts_published; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.artifacts_published ENABLE ROW LEVEL SECURITY;

--
-- Name: company_profile auth_read_company_profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_read_company_profile ON public.company_profile FOR SELECT TO authenticated USING (true);


--
-- Name: live_artifacts authenticated_published_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_published_read ON public.live_artifacts FOR SELECT TO authenticated USING (((is_published = true) AND (deleted_at IS NULL) AND ((expires_at IS NULL) OR (expires_at > now()))));


--
-- Name: agent_tasks authenticated_read_tasks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_read_tasks ON public.agent_tasks FOR SELECT TO authenticated USING (true);


--
-- Name: automation_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: automation_runs automation_runs_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY automation_runs_admin_all ON public.automation_runs TO authenticated USING (public.has_role(auth.uid(), 'super_admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: automation_runs automation_runs_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY automation_runs_member_select ON public.automation_runs FOR SELECT TO authenticated USING ((public.has_role(auth.uid(), 'super_admin'::public.app_role) OR (EXISTS ( SELECT 1
   FROM public.automations a
  WHERE ((a.id = automation_runs.automation_id) AND (a.created_by = auth.uid()))))));


--
-- Name: automations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.automations ENABLE ROW LEVEL SECURITY;

--
-- Name: automations automations_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY automations_admin_all ON public.automations TO authenticated USING (public.has_role(auth.uid(), 'super_admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: automations automations_member_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY automations_member_select ON public.automations FOR SELECT TO authenticated USING (((created_by = auth.uid()) OR public.has_role(auth.uid(), 'super_admin'::public.app_role)));


--
-- Name: branding; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.branding ENABLE ROW LEVEL SECURITY;

--
-- Name: channel_agent_activity; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.channel_agent_activity ENABLE ROW LEVEL SECURITY;

--
-- Name: channel_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.channel_members ENABLE ROW LEVEL SECURITY;

--
-- Name: channel_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.channel_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: channels; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;

--
-- Name: company_profile; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.company_profile ENABLE ROW LEVEL SECURITY;

--
-- Name: conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_creation_log creator reads own creation logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "creator reads own creation logs" ON public.agent_creation_log FOR SELECT TO authenticated USING ((created_by = auth.uid()));


--
-- Name: cron_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cron_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: dm_reads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dm_reads ENABLE ROW LEVEL SECURITY;

--
-- Name: drafts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.drafts ENABLE ROW LEVEL SECURITY;

--
-- Name: email_send_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_send_log ENABLE ROW LEVEL SECURITY;

--
-- Name: email_send_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_send_state ENABLE ROW LEVEL SECURITY;

--
-- Name: email_unsubscribe_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_unsubscribe_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: gateway_health; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.gateway_health ENABLE ROW LEVEL SECURITY;

--
-- Name: generated_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.generated_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: integration_rate_limit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.integration_rate_limit ENABLE ROW LEVEL SECURITY;

--
-- Name: integration_secrets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.integration_secrets ENABLE ROW LEVEL SECURITY;

--
-- Name: integration_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.integration_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: integrations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;

--
-- Name: live_artifacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.live_artifacts ENABLE ROW LEVEL SECURITY;

--
-- Name: llm_provider_ops; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.llm_provider_ops ENABLE ROW LEVEL SECURITY;

--
-- Name: channel_agent_activity membros_leem_atividade; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY membros_leem_atividade ON public.channel_agent_activity FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.channel_members m
  WHERE ((m.channel_id = channel_agent_activity.channel_id) AND (m.user_id = (auth.uid())::text)))));


--
-- Name: message_reactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

--
-- Name: model_pricing; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.model_pricing ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: onboarding_progress; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.onboarding_progress ENABLE ROW LEVEL SECURITY;

--
-- Name: generated_documents own_docs_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY own_docs_delete ON public.generated_documents FOR DELETE USING ((auth.uid() = user_id));


--
-- Name: generated_documents own_docs_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY own_docs_insert ON public.generated_documents FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: generated_documents own_docs_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY own_docs_select ON public.generated_documents FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: live_artifacts owner_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_all ON public.live_artifacts USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: live_artifacts public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY public_read ON public.live_artifacts FOR SELECT USING (((is_published = true) AND (deleted_at IS NULL) AND (is_public = true) AND ((expires_at IS NULL) OR (expires_at > now()))));


--
-- Name: push_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: routine_phrases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.routine_phrases ENABLE ROW LEVEL SECURITY;

--
-- Name: setup_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.setup_config ENABLE ROW LEVEL SECURITY;

--
-- Name: skills; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.skills ENABLE ROW LEVEL SECURITY;

--
-- Name: skills skills_authenticated_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY skills_authenticated_read ON public.skills FOR SELECT TO authenticated USING (true);


--
-- Name: subagent_watch; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subagent_watch ENABLE ROW LEVEL SECURITY;

--
-- Name: vps_config super_admin can delete vps_config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "super_admin can delete vps_config" ON public.vps_config FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: vps_config super_admin can insert vps_config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "super_admin can insert vps_config" ON public.vps_config FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: setup_config super_admin can read setup_config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "super_admin can read setup_config" ON public.setup_config FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: vps_config super_admin can update vps_config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "super_admin can update vps_config" ON public.vps_config FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'super_admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: vps_config super_admin can view vps_config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "super_admin can view vps_config" ON public.vps_config FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: agent_creation_log super_admin reads all creation logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "super_admin reads all creation logs" ON public.agent_creation_log FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: agent_tasks super_admin_manage_tasks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY super_admin_manage_tasks ON public.agent_tasks TO authenticated USING (public.has_role(auth.uid(), 'super_admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));


--
-- Name: suppressed_emails; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.suppressed_emails ENABLE ROW LEVEL SECURITY;

--
-- Name: team_agents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.team_agents ENABLE ROW LEVEL SECURITY;

--
-- Name: teams; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

--
-- Name: usage_daily; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.usage_daily ENABLE ROW LEVEL SECURITY;

--
-- Name: usage_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

--
-- Name: usage_session_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.usage_session_state ENABLE ROW LEVEL SECURITY;

--
-- Name: user_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: vps_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vps_config ENABLE ROW LEVEL SECURITY;

--
-- Name: wiki_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wiki_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: wiki_spaces; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wiki_spaces ENABLE ROW LEVEL SECURITY;

--
-- Name: FUNCTION channel_messages_dedup_guard(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.channel_messages_dedup_guard() TO anon;
GRANT ALL ON FUNCTION public.channel_messages_dedup_guard() TO authenticated;
GRANT ALL ON FUNCTION public.channel_messages_dedup_guard() TO service_role;


--
-- Name: FUNCTION check_invoke_rate(_user_id uuid, _limit integer, _window_secs integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.check_invoke_rate(_user_id uuid, _limit integer, _window_secs integer) TO anon;
GRANT ALL ON FUNCTION public.check_invoke_rate(_user_id uuid, _limit integer, _window_secs integer) TO authenticated;
GRANT ALL ON FUNCTION public.check_invoke_rate(_user_id uuid, _limit integer, _window_secs integer) TO service_role;


--
-- Name: FUNCTION cleanup_agent_activity_log(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.cleanup_agent_activity_log() TO anon;
GRANT ALL ON FUNCTION public.cleanup_agent_activity_log() TO authenticated;
GRANT ALL ON FUNCTION public.cleanup_agent_activity_log() TO service_role;


--
-- Name: FUNCTION delete_email(queue_name text, message_id bigint); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.delete_email(queue_name text, message_id bigint) TO anon;
GRANT ALL ON FUNCTION public.delete_email(queue_name text, message_id bigint) TO authenticated;
GRANT ALL ON FUNCTION public.delete_email(queue_name text, message_id bigint) TO service_role;


--
-- Name: FUNCTION email_queue_dispatch(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.email_queue_dispatch() TO anon;
GRANT ALL ON FUNCTION public.email_queue_dispatch() TO authenticated;
GRANT ALL ON FUNCTION public.email_queue_dispatch() TO service_role;


--
-- Name: FUNCTION email_queue_wake(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.email_queue_wake() TO anon;
GRANT ALL ON FUNCTION public.email_queue_wake() TO authenticated;
GRANT ALL ON FUNCTION public.email_queue_wake() TO service_role;


--
-- Name: FUNCTION enqueue_email(queue_name text, payload jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.enqueue_email(queue_name text, payload jsonb) TO anon;
GRANT ALL ON FUNCTION public.enqueue_email(queue_name text, payload jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.enqueue_email(queue_name text, payload jsonb) TO service_role;


--
-- Name: FUNCTION find_or_create_agent_agent_dm(_sender_agent_id text, _recipient_agent_id text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.find_or_create_agent_agent_dm(_sender_agent_id text, _recipient_agent_id text) TO anon;
GRANT ALL ON FUNCTION public.find_or_create_agent_agent_dm(_sender_agent_id text, _recipient_agent_id text) TO authenticated;
GRANT ALL ON FUNCTION public.find_or_create_agent_agent_dm(_sender_agent_id text, _recipient_agent_id text) TO service_role;


--
-- Name: FUNCTION find_or_create_agent_dm(_agent_id text, _agent_name text, _target_user_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.find_or_create_agent_dm(_agent_id text, _agent_name text, _target_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.find_or_create_agent_dm(_agent_id text, _agent_name text, _target_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.find_or_create_agent_dm(_agent_id text, _agent_name text, _target_user_id uuid) TO service_role;


--
-- Name: FUNCTION find_or_create_dm(_target_user_id uuid, _target_name text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.find_or_create_dm(_target_user_id uuid, _target_name text) TO anon;
GRANT ALL ON FUNCTION public.find_or_create_dm(_target_user_id uuid, _target_name text) TO authenticated;
GRANT ALL ON FUNCTION public.find_or_create_dm(_target_user_id uuid, _target_name text) TO service_role;


--
-- Name: FUNCTION get_agents_last_activity(_agent_ids text[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_agents_last_activity(_agent_ids text[]) TO anon;
GRANT ALL ON FUNCTION public.get_agents_last_activity(_agent_ids text[]) TO authenticated;
GRANT ALL ON FUNCTION public.get_agents_last_activity(_agent_ids text[]) TO service_role;


--
-- Name: FUNCTION get_agents_last_activity(_agent_ids text[], _user_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_agents_last_activity(_agent_ids text[], _user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_agents_last_activity(_agent_ids text[], _user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_agents_last_activity(_agent_ids text[], _user_id uuid) TO service_role;


--
-- Name: FUNCTION get_fleet_productivity(_since timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_fleet_productivity(_since timestamp with time zone) TO anon;
GRANT ALL ON FUNCTION public.get_fleet_productivity(_since timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.get_fleet_productivity(_since timestamp with time zone) TO service_role;


--
-- Name: FUNCTION get_user_agent_activity(_since timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_user_agent_activity(_since timestamp with time zone) TO anon;
GRANT ALL ON FUNCTION public.get_user_agent_activity(_since timestamp with time zone) TO authenticated;
GRANT ALL ON FUNCTION public.get_user_agent_activity(_since timestamp with time zone) TO service_role;


--
-- Name: FUNCTION get_user_role(_user_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_user_role(_user_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_user_role(_user_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_user_role(_user_id uuid) TO service_role;


--
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.handle_new_user() TO anon;
GRANT ALL ON FUNCTION public.handle_new_user() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;


--
-- Name: FUNCTION has_role(_user_id uuid, _role public.app_role); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.has_role(_user_id uuid, _role public.app_role) TO anon;
GRANT ALL ON FUNCTION public.has_role(_user_id uuid, _role public.app_role) TO authenticated;
GRANT ALL ON FUNCTION public.has_role(_user_id uuid, _role public.app_role) TO service_role;


--
-- Name: FUNCTION invoke_edge_function(_fn text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.invoke_edge_function(_fn text) TO anon;
GRANT ALL ON FUNCTION public.invoke_edge_function(_fn text) TO authenticated;
GRANT ALL ON FUNCTION public.invoke_edge_function(_fn text) TO service_role;


--
-- Name: FUNCTION is_channel_member(_channel_id uuid, _user_id text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_channel_member(_channel_id uuid, _user_id text) TO anon;
GRANT ALL ON FUNCTION public.is_channel_member(_channel_id uuid, _user_id text) TO authenticated;
GRANT ALL ON FUNCTION public.is_channel_member(_channel_id uuid, _user_id text) TO service_role;


--
-- Name: FUNCTION is_public_channel(_channel_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_public_channel(_channel_id uuid) TO anon;
GRANT ALL ON FUNCTION public.is_public_channel(_channel_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_public_channel(_channel_id uuid) TO service_role;


--
-- Name: FUNCTION mark_agent_turn_delivered(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.mark_agent_turn_delivered() TO anon;
GRANT ALL ON FUNCTION public.mark_agent_turn_delivered() TO authenticated;
GRANT ALL ON FUNCTION public.mark_agent_turn_delivered() TO service_role;


--
-- Name: FUNCTION move_to_dlq(source_queue text, dlq_name text, message_id bigint, payload jsonb); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.move_to_dlq(source_queue text, dlq_name text, message_id bigint, payload jsonb) TO anon;
GRANT ALL ON FUNCTION public.move_to_dlq(source_queue text, dlq_name text, message_id bigint, payload jsonb) TO authenticated;
GRANT ALL ON FUNCTION public.move_to_dlq(source_queue text, dlq_name text, message_id bigint, payload jsonb) TO service_role;


--
-- Name: FUNCTION post_task_completion_to_chat(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.post_task_completion_to_chat() TO anon;
GRANT ALL ON FUNCTION public.post_task_completion_to_chat() TO authenticated;
GRANT ALL ON FUNCTION public.post_task_completion_to_chat() TO service_role;


--
-- Name: FUNCTION read_email_batch(queue_name text, batch_size integer, vt integer); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.read_email_batch(queue_name text, batch_size integer, vt integer) TO anon;
GRANT ALL ON FUNCTION public.read_email_batch(queue_name text, batch_size integer, vt integer) TO authenticated;
GRANT ALL ON FUNCTION public.read_email_batch(queue_name text, batch_size integer, vt integer) TO service_role;


--
-- Name: FUNCTION run_zombie_watchdog(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.run_zombie_watchdog() TO anon;
GRANT ALL ON FUNCTION public.run_zombie_watchdog() TO authenticated;
GRANT ALL ON FUNCTION public.run_zombie_watchdog() TO service_role;


--
-- Name: FUNCTION set_drafts_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_drafts_updated_at() TO anon;
GRANT ALL ON FUNCTION public.set_drafts_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_drafts_updated_at() TO service_role;


--
-- Name: FUNCTION sync_channel_members_rest_fields(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sync_channel_members_rest_fields() TO anon;
GRANT ALL ON FUNCTION public.sync_channel_members_rest_fields() TO authenticated;
GRANT ALL ON FUNCTION public.sync_channel_members_rest_fields() TO service_role;


--
-- Name: FUNCTION trigger_send_push_on_notification(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.trigger_send_push_on_notification() TO anon;
GRANT ALL ON FUNCTION public.trigger_send_push_on_notification() TO authenticated;
GRANT ALL ON FUNCTION public.trigger_send_push_on_notification() TO service_role;


--
-- Name: FUNCTION update_updated_at_column(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.update_updated_at_column() TO anon;
GRANT ALL ON FUNCTION public.update_updated_at_column() TO authenticated;
GRANT ALL ON FUNCTION public.update_updated_at_column() TO service_role;


--
-- Name: FUNCTION upsert_platform_vault(_project_url text, _service_role_key text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.upsert_platform_vault(_project_url text, _service_role_key text) TO anon;
GRANT ALL ON FUNCTION public.upsert_platform_vault(_project_url text, _service_role_key text) TO authenticated;
GRANT ALL ON FUNCTION public.upsert_platform_vault(_project_url text, _service_role_key text) TO service_role;


--
-- Name: FUNCTION wiki_documents_set_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.wiki_documents_set_updated_at() TO anon;
GRANT ALL ON FUNCTION public.wiki_documents_set_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.wiki_documents_set_updated_at() TO service_role;


--
-- Name: TABLE access_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.access_logs TO anon;
GRANT ALL ON TABLE public.access_logs TO authenticated;
GRANT ALL ON TABLE public.access_logs TO service_role;
GRANT SELECT,INSERT ON TABLE public.access_logs TO sandbox_exec;


--
-- Name: TABLE agent_activity; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.agent_activity TO anon;
GRANT ALL ON TABLE public.agent_activity TO authenticated;
GRANT ALL ON TABLE public.agent_activity TO service_role;
GRANT SELECT,INSERT ON TABLE public.agent_activity TO sandbox_exec;


--
-- Name: TABLE agent_activity_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.agent_activity_log TO anon;
GRANT ALL ON TABLE public.agent_activity_log TO authenticated;
GRANT ALL ON TABLE public.agent_activity_log TO service_role;
GRANT SELECT,INSERT ON TABLE public.agent_activity_log TO sandbox_exec;


--
-- Name: TABLE agent_avatars; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.agent_avatars TO anon;
GRANT ALL ON TABLE public.agent_avatars TO authenticated;
GRANT ALL ON TABLE public.agent_avatars TO service_role;
GRANT SELECT,INSERT ON TABLE public.agent_avatars TO sandbox_exec;


--
-- Name: TABLE agent_context_state; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.agent_context_state TO anon;
GRANT ALL ON TABLE public.agent_context_state TO authenticated;
GRANT ALL ON TABLE public.agent_context_state TO service_role;
GRANT SELECT,INSERT ON TABLE public.agent_context_state TO sandbox_exec;


--
-- Name: TABLE agent_creation_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.agent_creation_log TO anon;
GRANT ALL ON TABLE public.agent_creation_log TO authenticated;
GRANT ALL ON TABLE public.agent_creation_log TO service_role;
GRANT SELECT,INSERT ON TABLE public.agent_creation_log TO sandbox_exec;


--
-- Name: TABLE agent_crons; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.agent_crons TO anon;
GRANT ALL ON TABLE public.agent_crons TO authenticated;
GRANT ALL ON TABLE public.agent_crons TO service_role;
GRANT SELECT,INSERT ON TABLE public.agent_crons TO sandbox_exec;


--
-- Name: TABLE agent_files; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.agent_files TO anon;
GRANT ALL ON TABLE public.agent_files TO authenticated;
GRANT ALL ON TABLE public.agent_files TO service_role;
GRANT SELECT,INSERT ON TABLE public.agent_files TO sandbox_exec;


--
-- Name: TABLE agent_integrations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.agent_integrations TO anon;
GRANT ALL ON TABLE public.agent_integrations TO authenticated;
GRANT ALL ON TABLE public.agent_integrations TO service_role;
GRANT SELECT,INSERT ON TABLE public.agent_integrations TO sandbox_exec;


--
-- Name: TABLE agent_profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.agent_profiles TO anon;
GRANT ALL ON TABLE public.agent_profiles TO authenticated;
GRANT ALL ON TABLE public.agent_profiles TO service_role;
GRANT SELECT,INSERT ON TABLE public.agent_profiles TO sandbox_exec;


--
-- Name: TABLE agent_results; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.agent_results TO anon;
GRANT ALL ON TABLE public.agent_results TO authenticated;
GRANT ALL ON TABLE public.agent_results TO service_role;
GRANT SELECT,INSERT ON TABLE public.agent_results TO sandbox_exec;


--
-- Name: TABLE agent_skills; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.agent_skills TO anon;
GRANT ALL ON TABLE public.agent_skills TO authenticated;
GRANT ALL ON TABLE public.agent_skills TO service_role;
GRANT SELECT,INSERT ON TABLE public.agent_skills TO sandbox_exec;


--
-- Name: TABLE agent_stats; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.agent_stats TO anon;
GRANT ALL ON TABLE public.agent_stats TO authenticated;
GRANT ALL ON TABLE public.agent_stats TO service_role;
GRANT SELECT,INSERT ON TABLE public.agent_stats TO sandbox_exec;


--
-- Name: TABLE agent_tasks; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.agent_tasks TO anon;
GRANT ALL ON TABLE public.agent_tasks TO authenticated;
GRANT ALL ON TABLE public.agent_tasks TO service_role;
GRANT SELECT,INSERT ON TABLE public.agent_tasks TO sandbox_exec;


--
-- Name: TABLE agent_templates; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.agent_templates TO anon;
GRANT ALL ON TABLE public.agent_templates TO authenticated;
GRANT ALL ON TABLE public.agent_templates TO service_role;
GRANT SELECT,INSERT ON TABLE public.agent_templates TO sandbox_exec;


--
-- Name: TABLE agent_token_snapshots; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.agent_token_snapshots TO anon;
GRANT ALL ON TABLE public.agent_token_snapshots TO authenticated;
GRANT ALL ON TABLE public.agent_token_snapshots TO service_role;
GRANT SELECT,INSERT ON TABLE public.agent_token_snapshots TO sandbox_exec;


--
-- Name: TABLE agent_turn_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.agent_turn_events TO anon;
GRANT ALL ON TABLE public.agent_turn_events TO authenticated;
GRANT ALL ON TABLE public.agent_turn_events TO service_role;
GRANT SELECT,INSERT ON TABLE public.agent_turn_events TO sandbox_exec;


--
-- Name: TABLE agent_turns; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.agent_turns TO anon;
GRANT ALL ON TABLE public.agent_turns TO authenticated;
GRANT ALL ON TABLE public.agent_turns TO service_role;
GRANT SELECT,INSERT ON TABLE public.agent_turns TO sandbox_exec;


--
-- Name: TABLE app_settings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.app_settings TO anon;
GRANT ALL ON TABLE public.app_settings TO authenticated;
GRANT ALL ON TABLE public.app_settings TO service_role;
GRANT SELECT,INSERT ON TABLE public.app_settings TO sandbox_exec;


--
-- Name: TABLE arena_agents; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.arena_agents TO anon;
GRANT ALL ON TABLE public.arena_agents TO authenticated;
GRANT ALL ON TABLE public.arena_agents TO service_role;
GRANT SELECT,INSERT ON TABLE public.arena_agents TO sandbox_exec;


--
-- Name: TABLE arena_messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.arena_messages TO anon;
GRANT ALL ON TABLE public.arena_messages TO authenticated;
GRANT ALL ON TABLE public.arena_messages TO service_role;
GRANT SELECT,INSERT ON TABLE public.arena_messages TO sandbox_exec;


--
-- Name: TABLE arena_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.arena_sessions TO anon;
GRANT ALL ON TABLE public.arena_sessions TO authenticated;
GRANT ALL ON TABLE public.arena_sessions TO service_role;
GRANT SELECT,INSERT ON TABLE public.arena_sessions TO sandbox_exec;


--
-- Name: TABLE arena_templates; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.arena_templates TO anon;
GRANT ALL ON TABLE public.arena_templates TO authenticated;
GRANT ALL ON TABLE public.arena_templates TO service_role;
GRANT SELECT,INSERT ON TABLE public.arena_templates TO sandbox_exec;


--
-- Name: TABLE arenas; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.arenas TO anon;
GRANT ALL ON TABLE public.arenas TO authenticated;
GRANT ALL ON TABLE public.arenas TO service_role;
GRANT SELECT,INSERT ON TABLE public.arenas TO sandbox_exec;


--
-- Name: TABLE artifact_titles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.artifact_titles TO anon;
GRANT ALL ON TABLE public.artifact_titles TO authenticated;
GRANT ALL ON TABLE public.artifact_titles TO service_role;
GRANT SELECT,INSERT ON TABLE public.artifact_titles TO sandbox_exec;


--
-- Name: TABLE artifacts_published; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.artifacts_published TO anon;
GRANT ALL ON TABLE public.artifacts_published TO authenticated;
GRANT ALL ON TABLE public.artifacts_published TO service_role;
GRANT SELECT,INSERT ON TABLE public.artifacts_published TO sandbox_exec;


--
-- Name: TABLE automation_runs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.automation_runs TO anon;
GRANT ALL ON TABLE public.automation_runs TO authenticated;
GRANT ALL ON TABLE public.automation_runs TO service_role;
GRANT SELECT,INSERT ON TABLE public.automation_runs TO sandbox_exec;


--
-- Name: TABLE automations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.automations TO anon;
GRANT ALL ON TABLE public.automations TO authenticated;
GRANT ALL ON TABLE public.automations TO service_role;
GRANT SELECT,INSERT ON TABLE public.automations TO sandbox_exec;


--
-- Name: TABLE branding; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.branding TO anon;
GRANT ALL ON TABLE public.branding TO authenticated;
GRANT ALL ON TABLE public.branding TO service_role;
GRANT SELECT,INSERT ON TABLE public.branding TO sandbox_exec;


--
-- Name: TABLE channel_agent_activity; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.channel_agent_activity TO anon;
GRANT ALL ON TABLE public.channel_agent_activity TO authenticated;
GRANT ALL ON TABLE public.channel_agent_activity TO service_role;
GRANT SELECT,INSERT ON TABLE public.channel_agent_activity TO sandbox_exec;


--
-- Name: TABLE channel_members; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.channel_members TO anon;
GRANT ALL ON TABLE public.channel_members TO authenticated;
GRANT ALL ON TABLE public.channel_members TO service_role;
GRANT SELECT,INSERT ON TABLE public.channel_members TO sandbox_exec;


--
-- Name: TABLE channel_messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.channel_messages TO anon;
GRANT ALL ON TABLE public.channel_messages TO authenticated;
GRANT ALL ON TABLE public.channel_messages TO service_role;
GRANT SELECT,INSERT ON TABLE public.channel_messages TO sandbox_exec;


--
-- Name: TABLE channels; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.channels TO anon;
GRANT ALL ON TABLE public.channels TO authenticated;
GRANT ALL ON TABLE public.channels TO service_role;
GRANT SELECT,INSERT ON TABLE public.channels TO sandbox_exec;


--
-- Name: TABLE company_profile; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.company_profile TO anon;
GRANT ALL ON TABLE public.company_profile TO authenticated;
GRANT ALL ON TABLE public.company_profile TO service_role;
GRANT SELECT,INSERT ON TABLE public.company_profile TO sandbox_exec;


--
-- Name: TABLE conversations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.conversations TO anon;
GRANT ALL ON TABLE public.conversations TO authenticated;
GRANT ALL ON TABLE public.conversations TO service_role;
GRANT SELECT,INSERT ON TABLE public.conversations TO sandbox_exec;


--
-- Name: TABLE cron_jobs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.cron_jobs TO anon;
GRANT ALL ON TABLE public.cron_jobs TO authenticated;
GRANT ALL ON TABLE public.cron_jobs TO service_role;
GRANT SELECT,INSERT ON TABLE public.cron_jobs TO sandbox_exec;


--
-- Name: TABLE dm_reads; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.dm_reads TO anon;
GRANT ALL ON TABLE public.dm_reads TO authenticated;
GRANT ALL ON TABLE public.dm_reads TO service_role;
GRANT SELECT,INSERT ON TABLE public.dm_reads TO sandbox_exec;


--
-- Name: TABLE drafts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.drafts TO anon;
GRANT ALL ON TABLE public.drafts TO authenticated;
GRANT ALL ON TABLE public.drafts TO service_role;
GRANT SELECT,INSERT ON TABLE public.drafts TO sandbox_exec;


--
-- Name: TABLE email_send_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.email_send_log TO anon;
GRANT ALL ON TABLE public.email_send_log TO authenticated;
GRANT ALL ON TABLE public.email_send_log TO service_role;
GRANT SELECT,INSERT ON TABLE public.email_send_log TO sandbox_exec;


--
-- Name: TABLE email_send_state; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.email_send_state TO anon;
GRANT ALL ON TABLE public.email_send_state TO authenticated;
GRANT ALL ON TABLE public.email_send_state TO service_role;
GRANT SELECT,INSERT ON TABLE public.email_send_state TO sandbox_exec;


--
-- Name: TABLE email_unsubscribe_tokens; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.email_unsubscribe_tokens TO anon;
GRANT ALL ON TABLE public.email_unsubscribe_tokens TO authenticated;
GRANT ALL ON TABLE public.email_unsubscribe_tokens TO service_role;
GRANT SELECT,INSERT ON TABLE public.email_unsubscribe_tokens TO sandbox_exec;


--
-- Name: TABLE gateway_health; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.gateway_health TO anon;
GRANT ALL ON TABLE public.gateway_health TO authenticated;
GRANT ALL ON TABLE public.gateway_health TO service_role;
GRANT SELECT,INSERT ON TABLE public.gateway_health TO sandbox_exec;


--
-- Name: TABLE generated_documents; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.generated_documents TO anon;
GRANT ALL ON TABLE public.generated_documents TO authenticated;
GRANT ALL ON TABLE public.generated_documents TO service_role;
GRANT SELECT,INSERT ON TABLE public.generated_documents TO sandbox_exec;


--
-- Name: TABLE integration_rate_limit; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.integration_rate_limit TO anon;
GRANT ALL ON TABLE public.integration_rate_limit TO authenticated;
GRANT ALL ON TABLE public.integration_rate_limit TO service_role;
GRANT SELECT,INSERT ON TABLE public.integration_rate_limit TO sandbox_exec;


--
-- Name: TABLE integration_secrets; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.integration_secrets TO anon;
GRANT ALL ON TABLE public.integration_secrets TO authenticated;
GRANT ALL ON TABLE public.integration_secrets TO service_role;
GRANT SELECT,INSERT ON TABLE public.integration_secrets TO sandbox_exec;


--
-- Name: TABLE integration_templates; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.integration_templates TO anon;
GRANT ALL ON TABLE public.integration_templates TO authenticated;
GRANT ALL ON TABLE public.integration_templates TO service_role;
GRANT SELECT,INSERT ON TABLE public.integration_templates TO sandbox_exec;


--
-- Name: TABLE integrations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.integrations TO anon;
GRANT ALL ON TABLE public.integrations TO authenticated;
GRANT ALL ON TABLE public.integrations TO service_role;
GRANT SELECT,INSERT ON TABLE public.integrations TO sandbox_exec;


--
-- Name: TABLE live_artifacts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.live_artifacts TO anon;
GRANT ALL ON TABLE public.live_artifacts TO authenticated;
GRANT ALL ON TABLE public.live_artifacts TO service_role;
GRANT SELECT,INSERT ON TABLE public.live_artifacts TO sandbox_exec;


--
-- Name: TABLE llm_provider_ops; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.llm_provider_ops TO anon;
GRANT ALL ON TABLE public.llm_provider_ops TO authenticated;
GRANT ALL ON TABLE public.llm_provider_ops TO service_role;
GRANT SELECT,INSERT ON TABLE public.llm_provider_ops TO sandbox_exec;


--
-- Name: TABLE message_reactions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.message_reactions TO anon;
GRANT ALL ON TABLE public.message_reactions TO authenticated;
GRANT ALL ON TABLE public.message_reactions TO service_role;
GRANT SELECT,INSERT ON TABLE public.message_reactions TO sandbox_exec;


--
-- Name: TABLE model_pricing; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.model_pricing TO anon;
GRANT ALL ON TABLE public.model_pricing TO authenticated;
GRANT ALL ON TABLE public.model_pricing TO service_role;
GRANT SELECT,INSERT ON TABLE public.model_pricing TO sandbox_exec;


--
-- Name: TABLE notifications; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notifications TO anon;
GRANT ALL ON TABLE public.notifications TO authenticated;
GRANT ALL ON TABLE public.notifications TO service_role;
GRANT SELECT,INSERT ON TABLE public.notifications TO sandbox_exec;


--
-- Name: TABLE onboarding_progress; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.onboarding_progress TO anon;
GRANT ALL ON TABLE public.onboarding_progress TO authenticated;
GRANT ALL ON TABLE public.onboarding_progress TO service_role;
GRANT SELECT,INSERT ON TABLE public.onboarding_progress TO sandbox_exec;


--
-- Name: TABLE profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.profiles TO anon;
GRANT ALL ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;
GRANT SELECT,INSERT ON TABLE public.profiles TO sandbox_exec;


--
-- Name: TABLE push_subscriptions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.push_subscriptions TO anon;
GRANT ALL ON TABLE public.push_subscriptions TO authenticated;
GRANT ALL ON TABLE public.push_subscriptions TO service_role;
GRANT SELECT,INSERT ON TABLE public.push_subscriptions TO sandbox_exec;


--
-- Name: TABLE routine_phrases; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.routine_phrases TO anon;
GRANT ALL ON TABLE public.routine_phrases TO authenticated;
GRANT ALL ON TABLE public.routine_phrases TO service_role;
GRANT SELECT,INSERT ON TABLE public.routine_phrases TO sandbox_exec;


--
-- Name: TABLE setup_config; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.setup_config TO anon;
GRANT ALL ON TABLE public.setup_config TO authenticated;
GRANT ALL ON TABLE public.setup_config TO service_role;
GRANT SELECT,INSERT ON TABLE public.setup_config TO sandbox_exec;


--
-- Name: TABLE skills; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.skills TO anon;
GRANT ALL ON TABLE public.skills TO authenticated;
GRANT ALL ON TABLE public.skills TO service_role;
GRANT SELECT,INSERT ON TABLE public.skills TO sandbox_exec;


--
-- Name: TABLE subagent_watch; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.subagent_watch TO anon;
GRANT ALL ON TABLE public.subagent_watch TO authenticated;
GRANT ALL ON TABLE public.subagent_watch TO service_role;
GRANT SELECT,INSERT ON TABLE public.subagent_watch TO sandbox_exec;


--
-- Name: TABLE suppressed_emails; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.suppressed_emails TO anon;
GRANT ALL ON TABLE public.suppressed_emails TO authenticated;
GRANT ALL ON TABLE public.suppressed_emails TO service_role;
GRANT SELECT,INSERT ON TABLE public.suppressed_emails TO sandbox_exec;


--
-- Name: TABLE team_agents; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.team_agents TO anon;
GRANT ALL ON TABLE public.team_agents TO authenticated;
GRANT ALL ON TABLE public.team_agents TO service_role;
GRANT SELECT,INSERT ON TABLE public.team_agents TO sandbox_exec;


--
-- Name: TABLE teams; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.teams TO anon;
GRANT ALL ON TABLE public.teams TO authenticated;
GRANT ALL ON TABLE public.teams TO service_role;
GRANT SELECT,INSERT ON TABLE public.teams TO sandbox_exec;


--
-- Name: TABLE usage_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.usage_events TO anon;
GRANT ALL ON TABLE public.usage_events TO authenticated;
GRANT ALL ON TABLE public.usage_events TO service_role;
GRANT SELECT,INSERT ON TABLE public.usage_events TO sandbox_exec;


--
-- Name: TABLE usage_by_agent_day; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.usage_by_agent_day TO anon;
GRANT ALL ON TABLE public.usage_by_agent_day TO authenticated;
GRANT ALL ON TABLE public.usage_by_agent_day TO service_role;
GRANT SELECT,INSERT ON TABLE public.usage_by_agent_day TO sandbox_exec;


--
-- Name: TABLE usage_by_model_day; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.usage_by_model_day TO anon;
GRANT ALL ON TABLE public.usage_by_model_day TO authenticated;
GRANT ALL ON TABLE public.usage_by_model_day TO service_role;
GRANT SELECT,INSERT ON TABLE public.usage_by_model_day TO sandbox_exec;


--
-- Name: TABLE usage_by_task_day; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.usage_by_task_day TO anon;
GRANT ALL ON TABLE public.usage_by_task_day TO authenticated;
GRANT ALL ON TABLE public.usage_by_task_day TO service_role;
GRANT SELECT,INSERT ON TABLE public.usage_by_task_day TO sandbox_exec;


--
-- Name: TABLE usage_daily; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.usage_daily TO anon;
GRANT ALL ON TABLE public.usage_daily TO authenticated;
GRANT ALL ON TABLE public.usage_daily TO service_role;
GRANT SELECT,INSERT ON TABLE public.usage_daily TO sandbox_exec;


--
-- Name: SEQUENCE usage_events_id_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.usage_events_id_seq TO anon;
GRANT ALL ON SEQUENCE public.usage_events_id_seq TO authenticated;
GRANT ALL ON SEQUENCE public.usage_events_id_seq TO service_role;
GRANT SELECT,USAGE ON SEQUENCE public.usage_events_id_seq TO sandbox_exec;


--
-- Name: TABLE usage_session_state; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.usage_session_state TO anon;
GRANT ALL ON TABLE public.usage_session_state TO authenticated;
GRANT ALL ON TABLE public.usage_session_state TO service_role;
GRANT SELECT,INSERT ON TABLE public.usage_session_state TO sandbox_exec;


--
-- Name: TABLE user_roles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_roles TO anon;
GRANT ALL ON TABLE public.user_roles TO authenticated;
GRANT ALL ON TABLE public.user_roles TO service_role;
GRANT SELECT,INSERT ON TABLE public.user_roles TO sandbox_exec;


--
-- Name: TABLE vps_config; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vps_config TO anon;
GRANT ALL ON TABLE public.vps_config TO authenticated;
GRANT ALL ON TABLE public.vps_config TO service_role;
GRANT SELECT,INSERT ON TABLE public.vps_config TO sandbox_exec;


--
-- Name: TABLE wiki_documents; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.wiki_documents TO anon;
GRANT ALL ON TABLE public.wiki_documents TO authenticated;
GRANT ALL ON TABLE public.wiki_documents TO service_role;
GRANT SELECT,INSERT ON TABLE public.wiki_documents TO sandbox_exec;


--
-- Name: TABLE wiki_spaces; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.wiki_spaces TO anon;
GRANT ALL ON TABLE public.wiki_spaces TO authenticated;
GRANT ALL ON TABLE public.wiki_spaces TO service_role;
GRANT SELECT,INSERT ON TABLE public.wiki_spaces TO sandbox_exec;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- PostgreSQL database dump complete
--

\unrestrict wGNj7nLjg1B9fycbDO1NucSemE8eCuLOTONDVaTaMZaec86UkyV5Zc0r9efT52v

