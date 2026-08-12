-- Los índices que el rendimiento de la app da por sentados, afirmados como invariante.
--
-- POR QUÉ ESTO ES UN TEST Y NO UN COMENTARIO. Un índice no cambia ningún resultado: se
-- puede borrar y las 349 comprobaciones de las otras suites siguen pasando en verde. Lo
-- único que cambia es que la app se vuelve lenta más adelante, en producción, sin que
-- nada lo señale — y "esto no lo usa nadie" es precisamente lo que dice el linter de
-- Supabase sobre un índice recién creado, porque todavía no hubo tráfico.
--
-- Así que un futuro "limpiemos los índices sin uso" tiene que discutir con un test que
-- explica para qué está cada uno, en vez de descubrirlo cuando la app ya está lenta.
--
-- El caso que carga con todo es §1: los helpers de membresía corren DENTRO DE CADA POLICY
-- DE CADA TABLA, y el índice compuesto (workspace_id, user_id) no los cubre porque
-- filtran por user_id solo.
\set ON_ERROR_STOP on

create or replace function pg_temp.check(p_condition boolean, p_label text) returns void language plpgsql as $$
begin
  if p_condition then raise notice 'PASS: %', p_label;
  else raise exception 'FAIL: %', p_label; end if;
end;
$$;

/*
  Comprueba que EXISTE UN ÍNDICE QUE EMPIEZA por la columna dada — no que exista un
  índice con cierto nombre.

  La diferencia importa: un B-tree solo sirve para un filtro por X si X es su PRIMERA
  columna, y afirmar el nombre dejaría pasar exactamente el bug que esta migración
  arregla — `(workspace_id, user_id)` "cubre" user_id por nombre y no lo cubre en la
  práctica. Lo que se afirma es la propiedad, no el artefacto.
*/
create or replace function pg_temp.has_leading_index(p_table text, p_column text)
  returns boolean language sql stable as $$
  select exists (
    select 1
    from   pg_index i
    join   pg_class c on c.oid = i.indrelid
    join   pg_attribute a
           on a.attrelid = c.oid
          and a.attnum = i.indkey[0]
    where  c.relnamespace = 'ez_finance'::regnamespace
    and    c.relname = p_table
    and    a.attname = p_column
  );
$$;

-- ===========================================================================
-- 1. EL CAMINO CALIENTE DE RLS.
-- ===========================================================================
select pg_temp.check(
  pg_temp.has_leading_index('workspace_members', 'user_id'),
  'workspace_members tiene un índice que EMPIEZA por user_id — los tres helpers de membresía filtran por eso solo, en cada policy de cada tabla'
);

-- Y el compuesto sigue ahí: es lo que impide que la misma persona entre dos veces al
-- mismo espacio, así que el índice nuevo lo acompaña, no lo reemplaza.
select pg_temp.check(
  exists (
    select 1 from pg_indexes
    where  schemaname = 'ez_finance' and tablename = 'workspace_members'
    and    indexname = 'workspace_members_user_workspace_unique'
  ),
  'y el índice único (workspace_id, user_id) sigue existiendo — el nuevo se suma, no lo sustituye'
);

-- ===========================================================================
-- 2. Claves foráneas cuyo costo aparece al BORRAR el padre.
--
--    Un ON DELETE RESTRICT obliga a Postgres a buscar hijas que apunten a la fila que se
--    borra. Sin índice es un scan completo, en los caminos de archivar y eliminar.
-- ===========================================================================
select pg_temp.check(
  pg_temp.has_leading_index('transactions', 'created_by'),
  'transactions.created_by está indexada — `isMine` en cada lista, y el set null del borrado de cuenta'
);

select pg_temp.check(
  pg_temp.has_leading_index('transactions', 'counter_account_id'),
  'transactions.counter_account_id está indexada — se lee al archivar o eliminar una cuenta'
);

select pg_temp.check(
  pg_temp.has_leading_index('scheduled_transactions', 'account_id'),
  'scheduled_transactions.account_id está indexada'
);

select pg_temp.check(
  pg_temp.has_leading_index('scheduled_transactions', 'category_id'),
  'scheduled_transactions.category_id está indexada'
);

select pg_temp.check(
  pg_temp.has_leading_index('category_limits', 'category_id'),
  'category_limits.category_id está indexada — es lo que impide borrar una categoría con límite'
);

-- ===========================================================================
-- 3. Los que ya estaban, para que un futuro barrido tampoco se los lleve.
-- ===========================================================================
select pg_temp.check(
  pg_temp.has_leading_index('transactions', 'workspace_id'),
  'transactions sigue indexada por workspace_id — el motor lee un mes de un espacio a la vez'
);

select pg_temp.check(
  pg_temp.has_leading_index('expense_splits', 'workspace_id'),
  'expense_splits sigue indexada por workspace_id — la lista de quién te debe'
);

do $$ begin raise notice 'ALL INDEX CHECKS PASSED'; end $$;
