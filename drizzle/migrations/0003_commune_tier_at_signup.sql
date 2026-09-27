CREATE OR REPLACE FUNCTION public.commune_tier_info(_key text)
RETURNS TABLE(label text, prix integer)
LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$
  SELECT t.label, t.prix FROM (VALUES
    ('commune_village_year','Abonnement Village',300),
    ('commune_petite_ville_year','Abonnement Petite ville',600),
    ('commune_ville_moyenne_year','Abonnement Ville moyenne',1500),
    ('commune_grande_ville_year','Abonnement Grande ville',3000),
    ('commune_metropole_year','Abonnement Métropole',6000),
    ('commune_metropole_xl_year','Abonnement Grande métropole',10000)
  ) AS t(k,label,prix) WHERE t.k = _key
$$;

-- Guard: the previous current_user check was always true inside a SECURITY DEFINER trigger.
CREATE OR REPLACE FUNCTION public.commune_profiles_billing_guard()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF coalesce(auth.role(), '') NOT IN ('authenticated','anon')
     OR coalesce(current_setting('app.bypass_billing_guard', true), '') = 'on'
     OR (auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'admin')) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.status_abonnement := 'incomplete';
    NEW.mode_paiement := 'stripe';
    NEW.chorus_status := NULL;
    NEW.chorus_requested_at := NULL;
    NEW.chorus_paid_at := NULL;
    NEW.chorus_due_date := NULL;
    NEW.abonnement_prix_annuel := 600;
    NEW.abonnement_label := 'Abonnement Petite ville';
    NEW.stripe_customer_id := NULL;
  ELSE
    NEW.status_abonnement := OLD.status_abonnement;
    NEW.mode_paiement := OLD.mode_paiement;
    NEW.chorus_status := OLD.chorus_status;
    NEW.chorus_requested_at := OLD.chorus_requested_at;
    NEW.chorus_paid_at := OLD.chorus_paid_at;
    NEW.chorus_due_date := OLD.chorus_due_date;
    NEW.stripe_customer_id := OLD.stripe_customer_id;
    NEW.abonnement_prix_annuel := OLD.abonnement_prix_annuel;
    NEW.abonnement_label := OLD.abonnement_label;
    NEW.abonnement_renouvellement := OLD.abonnement_renouvellement;
    NEW.user_id := OLD.user_id;
    NEW.email := OLD.email;
    IF OLD.code_postal IS NOT NULL AND btrim(OLD.code_postal) <> '' THEN
      NEW.code_postal := OLD.code_postal;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_commune_user()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_label text := 'Abonnement Petite ville';
  v_prix integer := 600;
  v_cp text := nullif(btrim(coalesce(NEW.raw_user_meta_data->>'code_postal','')), '');
  r record;
BEGIN
  SELECT * INTO r FROM public.commune_tier_info(NEW.raw_user_meta_data->>'price_id');
  IF FOUND THEN v_label := r.label; v_prix := r.prix; END IF;
  IF v_cp IS NOT NULL AND v_cp !~ '^\d{5}$' THEN v_cp := NULL; END IF;

  PERFORM set_config('app.bypass_billing_guard', 'on', true);
  INSERT INTO public.commune_profiles (user_id, email, nom_collectivite, code_postal, status_abonnement, abonnement_label, abonnement_prix_annuel)
  VALUES (NEW.id, NEW.email,
    COALESCE(NULLIF(btrim(NEW.raw_user_meta_data->>'nom_collectivite'),''), split_part(NEW.email, '@', 1)),
    v_cp, 'incomplete', v_label, v_prix);
  PERFORM set_config('app.bypass_billing_guard', 'off', true);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_pending_tier(p_lookup_key text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_status text; r record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Non authentifié'; END IF;
  IF p_lookup_key = 'commune_metropole_xl_year' THEN RAISE EXCEPTION 'Palier sur devis'; END IF;
  SELECT * INTO r FROM public.commune_tier_info(p_lookup_key);
  IF NOT FOUND THEN RAISE EXCEPTION 'Palier inconnu'; END IF;
  SELECT status_abonnement INTO v_status FROM public.commune_profiles WHERE user_id = v_uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Profil introuvable'; END IF;
  IF v_status IN ('active','en_attente_mandat') THEN RAISE EXCEPTION 'Abonnement déjà actif'; END IF;
  PERFORM set_config('app.bypass_billing_guard', 'on', true);
  UPDATE public.commune_profiles SET abonnement_label = r.label, abonnement_prix_annuel = r.prix WHERE user_id = v_uid;
  PERFORM set_config('app.bypass_billing_guard', 'off', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.set_pending_tier(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.set_pending_tier(text) TO authenticated;