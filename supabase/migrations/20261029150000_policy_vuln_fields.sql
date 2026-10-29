-- Phase 10b, part 1: new policy rule fields for known vulnerabilities. Alone in this file because Postgres
-- cannot use a new enum value in the transaction that adds it (each migration file is one transaction).
--   cvss: the highest CVSS score of the known vulnerabilities that affect the installed version (0 = none)
--   kev:  whether one of them is in the CISA Known Exploited Vulnerabilities catalog
--   epss: the highest EPSS probability among them (0 to 1)
alter type public.policy_field add value if not exists 'cvss';
alter type public.policy_field add value if not exists 'kev';
alter type public.policy_field add value if not exists 'epss';
