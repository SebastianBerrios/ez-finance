-- =============================================================================
-- Índices que faltaban: el camino caliente de RLS y las claves foráneas.
--
-- EL QUE IMPORTA ES EL PRIMERO, y no es una micro-optimización.
--
-- Los tres helpers de membresía hacen, literalmente:
--
--     select workspace_id from ez_finance.workspace_members
--     where  user_id = (select auth.uid())
--
-- y eso se ejecuta DENTRO DE CADA POLICY DE CADA TABLA de este esquema: leer un
-- movimiento, una cuenta, una categoría, un presupuesto o un split pasa por ahí. Es la
-- consulta más frecuente de la app por un margen enorme.
--
-- El único índice que cubría `user_id` era `(workspace_id, user_id)`, compuesto y con
-- `workspace_id` PRIMERO — inservible para un filtro por `user_id` solo, porque un
-- B-tree solo puede empezar por su columna inicial. Así que era un scan secuencial de
-- workspace_members por cada chequeo de RLS.
--
-- LOS DEMÁS son claves foráneas sin índice de cobertura, y su costo aparece donde menos
-- se lo espera: al BORRAR el padre. Un `ON DELETE RESTRICT` obliga a Postgres a buscar
-- filas hijas que referencien la que se borra, y sin índice esa búsqueda es un scan
-- completo. Son exactamente los caminos de archivar/eliminar cuenta, categoría y
-- espacio — los que menos se ejercitan en desarrollo y peor escalan.
--
-- NO son `concurrently`: una migración corre en una transacción y `create index
-- concurrently` no puede. Con el volumen de estas tablas el lock es de milisegundos, y
-- cuando la app crezca lo suficiente para que importe, ya habrá graduado a su propio
-- proyecto (§6) y este archivo será historia.
--
-- `if not exists` en todos: un índice equivalente creado a mano en algún momento no debe
-- hacer fallar el push.
-- =============================================================================

begin;

-- 1. EL CAMINO CALIENTE DE RLS. Ver el encabezado.
--
--    Parcial: las filas con `user_id` nulo son lápidas de gente que eliminó su cuenta
--    (regla de oro: la historia sobrevive a la persona), y nadie las busca por usuario.
--    Excluirlas mantiene el índice del tamaño de la gente que realmente existe.
create index if not exists workspace_members_user_idx
  on ez_finance.workspace_members (user_id)
  where user_id is not null;

-- 2. `isMine` en cada lista de movimientos, y el `set null` del borrado de cuenta.
create index if not exists transactions_created_by_idx
  on ez_finance.transactions (created_by)
  where created_by is not null;

-- 3. La otra pata de una transferencia. Se lee al archivar o eliminar una cuenta, que es
--    cuando Postgres tiene que probar que ninguna transferencia la sigue apuntando.
create index if not exists transactions_counter_account_idx
  on ez_finance.transactions (counter_account_id)
  where counter_account_id is not null;

-- 4 y 5. Las referencias de una programada. Mismo caso: el RESTRICT al borrar la cuenta
--        o la categoría que la programada usa.
create index if not exists scheduled_transactions_account_idx
  on ez_finance.scheduled_transactions (account_id);

create index if not exists scheduled_transactions_category_idx
  on ez_finance.scheduled_transactions (category_id)
  where category_id is not null;

-- 6. El límite por categoría, que es lo que impide borrar una categoría con límite.
create index if not exists category_limits_category_idx
  on ez_finance.category_limits (category_id);

commit;
