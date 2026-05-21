-- Task template generation (Roadmap Stage 3)
-- Links generated tasks back to the template item they came from, and adds a
-- creation timestamp so the generator can avoid creating duplicate tasks.

alter table public.tasks
    add column created_at timestamp with time zone not null default now();
alter table public.tasks add column template_item_id bigint;

alter table public.tasks
    add constraint tasks_template_item_id_fkey foreign key (template_item_id) references public.task_template_items(id) on delete set null;

create index tasks_template_item_id_idx on public.tasks using btree (template_item_id);
