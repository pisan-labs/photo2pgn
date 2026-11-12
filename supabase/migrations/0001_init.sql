-- photo2pgn stores nothing per user in Supabase: games stay in the visitor's
-- browser, and photos for the HintWise reader wait in Netlify Blobs only
-- until they are read. This registers the app with the LLM gateway; its caps
-- are set by the owner, not here.
insert into platform.llm_apps (slug) values ('photo2pgn') on conflict do nothing;
