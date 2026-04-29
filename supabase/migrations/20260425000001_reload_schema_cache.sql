-- Force PostgREST schema cache reload after adding asana/todoist tables.
NOTIFY pgrst, 'reload schema';
