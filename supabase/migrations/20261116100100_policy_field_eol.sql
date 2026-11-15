-- Stage 3: the policy field "eol" (alone: an enum value cannot be used in the transaction that adds it).
alter type public.policy_field add value if not exists 'eol';
