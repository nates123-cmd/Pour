-- Sip: let `source` record WHICH open source corroborated the producer.
--
-- Applied by hand against xsmnfcmtbpeaccnyinkr; this repo is not linked and
-- nothing here runs automatically.
--
-- Producers can now be corroborated by Open Brewery DB (`obdb`, beer only) or
-- by Wikidata (`wd`, beer and spirits). The old CHECK was a fixed list of
-- literals, which is what made the last round of tags fail silently and fall
-- back to 'lookup' -- the ratings survived, the provenance never did. A pattern
-- keeps that from happening again the next time a source is added: the shape is
-- constrained, the vocabulary of corroborators is not.
alter table public.sip_tastings drop constraint if exists sip_tastings_source_check;
alter table public.sip_tastings add constraint sip_tastings_source_check
  check (source ~ '^(lookup|label|menu|import)(\+[a-z0-9]{2,8})*$');
