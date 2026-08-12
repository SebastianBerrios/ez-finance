# ez finance — Especificación funcional maestra

> **Qué es este documento.** La fuente única de "qué hace" ez finance: su
> comportamiento y sus reglas de negocio. Es la referencia de producto de la que
> se derivan los `spec.md` de cada feature (una sección de aquí -> un spec).
>
> **Qué NO es.** No describe arquitectura, capas, stack, base de datos ni
> proveedores. Todo el "cómo se construye" vive fuera de este documento (en las
> skills y en cada `plan.md`). Aquí solo hay comportamiento observable y reglas.
>
> **Idioma.** Toda la interfaz visible para el usuario está en español.
>
> **Cómo leer el estado de cada módulo.**
>
> - `[ESPECIFICADO]` — comportamiento definido en detalle; proviene de specs o
>   código ya existentes. Se puede construir tal cual.
> - `[ESBOZADO]` — la dirección es clara, pero faltan reglas finas. Lo que se
>   describe aquí es una propuesta razonable **por confirmar** en el spec del
>   feature.
> - `[PROPUESTA]` — el feature apenas está nombrado en el proyecto; todo lo de
>   aquí es una propuesta inicial para discutir.

---

## 1. Propósito del producto

ez finance es una app de finanzas personales y compartidas basada en la
metodología **50/30/20** (50 % necesidades, 30 % deseos, 20 % ahorro). Está
pensada para individuos, parejas y familias que quieren controlar su flujo de
caja y su presupuesto sin fricción.

Rasgos que definen la experiencia:

- Es una app con **login** (B2C). Una misma persona puede pertenecer a varios
  espacios financieros a la vez (los suyos y los compartidos).
- Es **mobile-first**: cada pantalla funciona bien desde 360 px de ancho.
- **Funciona sin conexión** para lo esencial y sincroniza al reconectar.
- La **legibilidad del monto** es la prioridad visual número uno; diseño
  minimalista y de alta confianza, con modo claro y oscuro.

**El principio conceptual central:** el 50/30/20 se calcula **sobre el ingreso
del mes, no sobre el gasto**. La app responde "¿cuánto del cubo de necesidades
de tu ingreso ya consumiste?", nunca "¿qué porcentaje de tus gastos fue
necesidad?". Esa distinción es lo que hace al dashboard útil en vez de engañoso.

---

## 2. Modelo mental y conceptos clave

- **Persona usuaria:** alguien con una cuenta en la app.
- **Workspace (espacio financiero):** el contenedor de toda la información
  financiera y el **dueño de los datos**. Las personas solo acceden a él. Hay dos
  tipos:
  - **Personal:** una sola persona. No admite invitaciones.
  - **Compartido:** varias personas con distintos roles.
- **Multi-pertenencia:** una persona puede estar en varios workspaces a la vez
  (por ejemplo, su "Personal" y un "Casa" compartido con su pareja).
- **Roles dentro de un workspace:** propietario, administrador, miembro y
  observador (ver la matriz en la sección 4).
- **Regla de oro de los datos:** toda la información financiera cuelga del
  workspace, **nunca de la persona directamente**. Si alguien sale del workspace
  o elimina su cuenta, lo que registró permanece en el workspace.

---

## 3. Principios de comportamiento transversales

Estos principios aplican a **toda** la app y condicionan el comportamiento de
cada módulo.

1. **Privacidad absoluta.** La información financiera es privada por defecto.
   La app no muestra publicidad de ningún tipo, no vende ni cede datos a terceros
   (ni siquiera agregados o anónimos), y no envía telemetría a servicios externos.
   La persona puede exportar toda su información y eliminar su cuenta en cualquier
   momento.
2. **Mensajes de error que no filtran.** Ninguna respuesta de la app revela si un
   correo existe en el sistema ni con qué método se registró. Los errores de
   autenticación son siempre genéricos.
3. **Offline-first como derecho.** Registrar transacciones, editar categorías y
   consultar el mes en curso funciona sin conexión y se sincroniza después.
   Ningún flujo crítico depende de estar en línea en tiempo real.

   **Qué funciona hoy sin conexión** (lo demás sigue pendiente, y decirlo importa
   más que prometerlo):

   - **Registrar y corregir un movimiento.** Se guarda en el dispositivo y se
     envía al reconectar, en el orden en que la persona lo hizo.
   - **Consultar** las pantallas de `/app` que ya visitó, tal como las dejó. La
     red siempre se prefiere: la copia local es para cuando no hay respuesta, no
     para que se sienta más rápido. Son cifras de dinero — mostrar una cacheada
     habiendo una viva sería mostrar un número que quizá ya es falso.
   - **La primera visita en un dispositivo no** funciona sin conexión; a partir de
     la segunda sí. Es inherente a cómo se activa un service worker.
   - **Editar categorías, cuentas o presupuesto NO** funciona sin conexión
     todavía: son actos de configuración, se hacen una vez y casi nunca en el
     colectivo. Fallan con su mensaje habitual en vez de fingir que se guardaron.

   **Conflictos: gana la última escritura, y se avisa.** Si un movimiento cambió
   mientras el dispositivo estaba sin conexión, la versión del dispositivo queda —
   pero la app lo dice. Nunca en silencio: una corrección que desaparece sin una
   palabra es indistinguible de una app que perdió el dato. Si el movimiento fue
   eliminado mientras tanto, **no se resucita**.

   **Lo guardado sin conexión sobrevive** que se cierre la app o que el teléfono
   mate la pestaña, y **al cerrar sesión se borran las copias locales de las
   pantallas** (son montos reales en un dispositivo posiblemente compartido, §3.1)
   pero **no la cola**: son movimientos que la persona registró y cree guardados.

4. **Preservación del historial.** La información de dominio se **archiva, no se
   borra**. Un reporte de marzo no se rompe porque en mayo la persona archive una
   categoría o una cuenta. El borrado físico solo aplica a datos sin valor
   histórico (sesiones, enlaces caducados, borradores) y a la eliminación de
   cuenta a solicitud de la persona.
5. **Precisión monetaria exacta.** Los cálculos con dinero son exactos; nunca
   aparecen errores de redondeo. En operaciones multi-moneda, la **tasa de cambio
   se congela al momento de registrar** la transacción y no se recalcula nunca
   después.
6. **Idioma y forma.** UI 100 % en español, responsive desde 360 px, tema claro
   y oscuro. Colores semánticos consistentes para ingreso / gasto / transferencia
   y para los cubos necesidad / deseo / ahorro.

---

## 4. Roles y matriz de permisos `[ESPECIFICADO]`

Un workspace **siempre** tiene al menos un propietario.

| Acción                                           | Observador | Miembro | Administrador | Propietario |
| ------------------------------------------------ | :--------: | :-----: | :-----------: | :---------: |
| Ver información del workspace                    |     Sí     |   Sí    |      Sí       |     Sí      |
| Registrar / editar transacciones propias         |     No     |   Sí    |      Sí       |     Sí      |
| Gestionar cuentas, categorías y presupuesto      |     No     |   No    |      Sí       |     Sí      |
| Invitar personas                                 |     No     |   No    |      Sí       |     Sí      |
| Cambiar rol de miembros y observadores           |     No     |   No    |      Sí       |     Sí      |
| Quitar miembros y observadores                   |     No     |   No    |      Sí       |     Sí      |
| Gestionar administradores (cambiar rol / quitar) |     No     |   No    |      No       |     Sí      |
| Archivar / eliminar el workspace                 |     No     |   No    |      No       |     Sí      |
| Transferir la propiedad                          |     No     |   No    |      No       |     Sí      |

Reglas duras de roles:

- Un **administrador no puede** modificar ni quitar a otro administrador ni al
  propietario. Eso solo lo hace el propietario.
- El **propietario no puede ser expulsado** por nadie. Las únicas formas de dejar
  de ser propietario son transferir la propiedad o eliminar la propia cuenta.
- El rol de **propietario nunca se asigna por invitación**; solo se transfiere.

---

## 5. Módulos funcionales

### 5.1 Autenticación y cuenta `[ESPECIFICADO]`

**Propósito.** Establecer la identidad de la persona y proteger su acceso. Es,
junto con workspaces, el cimiento del producto: sin identidad no hay contexto
para nada más.

**Qué puede hacer la persona:**

- Registrarse con **correo y contraseña**.
- Registrarse e iniciar sesión con su **cuenta de Google**.
- Iniciar y cerrar sesión.
- Recuperar su contraseña si la olvidó (solo cuentas de correo y contraseña).
- Mantener **varias sesiones abiertas a la vez** (teléfono, computadora), sin
  límite.
- Editar su **perfil**: nombre visible y foto.
- Cambiar su **contraseña** (solo cuentas de correo y contraseña).
- Cambiar su **correo**, con verificación en el correo nuevo (solo cuentas de
  correo y contraseña).
- Configurar su **idioma** y su **moneda por defecto**.
- **Eliminar su cuenta**, con período de gracia para arrepentirse.
- **Exportar** toda su información antes de eliminar la cuenta.

Al registrarse por cualquier método, se crea automáticamente un workspace
**"Personal"** donde la persona es propietaria, y se la lleva directamente a su
inicio.

**Reglas de negocio:**

- Un correo solo puede estar asociado a **una cuenta a la vez**.
- Una cuenta usa **un único método** de autenticación: correo y contraseña, o
  Google. No se mezclan ni se vinculan ambos.
- Si alguien intenta entrar con Google usando un correo que ya tiene cuenta de
  correo y contraseña, **no se le da acceso** ni se modifica la cuenta existente;
  se le invita a entrar con su método original, con un mensaje genérico.
- La contraseña debe tener **al menos 10 caracteres**, con al menos una letra y un
  número.
- Los mensajes de error nunca revelan si un correo existe ni con qué método se
  registró (siempre genéricos).
- El sistema se protege contra intentos repetidos de adivinar contraseñas y contra
  abuso del flujo de recuperación.
- Cambiar la contraseña **cierra todas las demás sesiones** de esa persona.
- El enlace de recuperación sirve **una sola vez** y **caduca a la hora** de
  generado.

**Eliminación de cuenta:**

- Al solicitarla, la cuenta entra en un **período de gracia de 30 días** y se
  cierran todas sus sesiones. Durante ese período la persona puede iniciar sesión
  y **cancelar** la eliminación.
- Pasados los 30 días, la cuenta se elimina de forma definitiva.
- Los workspaces donde era la **única integrante** se eliminan junto con la cuenta.
- En los workspaces **compartidos**, el espacio y lo que registró permanecen; sus
  registros dejan de atribuirse a una persona identificable y pasan a mostrarse
  como hechos por **"Usuario eliminado"**.
- Si es la **única propietaria** de un workspace compartido con otras integrantes,
  no puede eliminar su cuenta hasta transferir la propiedad o eliminar ese
  workspace.
- Al ejecutarse la eliminación definitiva, las invitaciones que había enviado
  quedan **revocadas** y las que había recibido quedan **caducadas**.

**Comportamiento para cuentas de Google.** Cambiar contraseña, cambiar correo o
pedir recuperación **no aplica** a cuentas de Google. La recuperación no envía
correo en ese caso, pero la app responde con el **mismo mensaje genérico** de
siempre.

---

### 5.2 Espacios financieros (workspaces) y colaboración `[ESPECIFICADO]`

**Propósito.** Dar la estructura de espacios sobre la que vive todo lo demás, con
aislamiento (cada persona solo ve los espacios a los que pertenece) y colaboración
con niveles de permiso.

**Qué puede hacer la persona:**

- Crear nuevos workspaces **compartidos**.
- **Cambiar de workspace** mediante un selector; al cambiar, toda la app pasa al
  contexto de ese espacio. El **último espacio activo se recuerda** entre sesiones.
- **Renombrar** un workspace.
- **Archivar** un workspace (lo deja en solo lectura: preserva los reportes
  históricos e impide registrar cosas nuevas) y **desarchivarlo**.
- **Eliminar** un workspace de forma definitiva (solo después de archivarlo y con
  confirmación explícita).

**Colaboración (solo en workspaces compartidos):**

- **Invitar** a otras personas por correo, asignándoles un rol.
- **Aceptar o rechazar** invitaciones recibidas.
- **Cambiar el rol** de un miembro existente.
- **Transferir la propiedad** del workspace a otro miembro.
- **Quitar** a un miembro.
- **Salir** voluntariamente de un workspace.

**Reglas de negocio:**

- Toda la información financiera pertenece al workspace, no a la persona.
- Un workspace siempre debe tener al menos un propietario.
- Para **salir siendo propietario**, primero hay que transferir la propiedad a
  otra persona (o archivar/eliminar el espacio).
- Los workspaces **personales no admiten invitaciones**.
- **Eliminar** un workspace requiere haberlo archivado antes y confirmar
  escribiendo su **nombre exacto**.

**Invitaciones:**

- Una invitación se dirige a un **correo concreto** y **caduca a los 7 días**.
- Sirve **una sola vez**. No se puede invitar a alguien que ya es integrante.
- Para aceptarla, la persona debe acceder con **exactamente el correo** al que se
  envió. Si aún no tiene cuenta, al registrarse con ese correo se une
  automáticamente con el rol indicado.

---

### 5.3 Cuentas (accounts) `[ESBOZADO]`

**Propósito.** Representar dónde vive el dinero de un workspace, para poder
calcular saldos y clasificar movimientos.

**Qué puede hacer la persona (propuesta):**

- Crear cuentas por **tipo**: efectivo, banco, tarjeta, billetera e inversión.
- Asignar a cada cuenta su **moneda** y su **saldo inicial**.
- Ver el **saldo actual** de cada cuenta (saldo inicial + suma de sus
  transacciones).
- Archivar una cuenta que ya no se usa (sin perder su historial).

**Reglas relevantes:**

- Las cuentas de tipo **ahorro** (savings) tienen un tratamiento especial en el
  presupuesto: transferir dinero **hacia** ellas cuenta como ahorro consumido
  (ver 5.6).
- El saldo de una cuenta se **calcula**, no se edita a mano.
- Archivar una cuenta es lógico (soft delete): sus movimientos siguen contando en
  los reportes históricos.

**Por definir en el spec:**

- ¿Qué tipos exactos existen y cómo se mapean al concepto "ahorro" del motor?
  (En el motor, "ahorro" es un tipo de cuenta; aquí conviene decidir si es un tipo
  aparte o una marca sobre banco/inversión.)
- ¿Puede una cuenta cambiar de moneda una vez creada? (Probablemente no, por
  coherencia del historial.)
- ¿Qué pasa al archivar una cuenta con saldo distinto de cero?
- ¿Hay saldo "objetivo" o solo saldo calculado?

---

### 5.4 Categorías (categories) `[ESBOZADO]`

**Propósito.** Clasificar transacciones y conectarlas con los cubos del 50/30/20.

**Qué puede hacer la persona (propuesta):**

- Crear categorías **jerárquicas**: categoría padre y subcategorías.
- Asignar a cada categoría un **tag de cubo 50/30/20**: necesidad, deseo o ahorro.
- **Archivar** una categoría (archivado lógico).

**Reglas relevantes:**

- Una categoría **archivada sigue contando** en los reportes históricos; la app
  solo la oculta del selector al registrar transacciones nuevas.
- El tag de cubo es lo que permite al motor de presupuesto ubicar cada gasto en su
  cubo.

**Por definir en el spec:**

- ¿El tag de cubo lo lleva la categoría padre, la subcategoría, o ambas pueden
  diferir?
- ¿Hay un set de categorías por defecto al crear un workspace?
- ¿Las categorías son por workspace (lo más probable) o por persona?
- ¿Se puede reasignar el cubo de una categoría, y cómo afecta eso a los reportes
  ya calculados? (Recordar el principio de preservación del historial.)

---

### 5.5 Transacciones (transactions) `[ESBOZADO]`

**Propósito.** Registrar el movimiento real del dinero; es la acción más
frecuente de la app y la que debe funcionar sin conexión.

**Qué puede hacer la persona (propuesta):**

- Registrar **ingresos**, **gastos** y **transferencias** entre cuentas.
- Asignar a cada movimiento su cuenta, monto, fecha, categoría (para
  ingresos/gastos) y una nota.
- Registrar movimientos en una **moneda distinta** a la de la cuenta, quedando
  guardada la tasa de cambio de ese momento.
- Editar y archivar sus propias transacciones (según su rol).

**Reglas relevantes:**

- Una **transferencia** se modela como un **par atado de dos filas** (salida de
  una cuenta, entrada en otra) que se crean y se deshacen juntas.
- La **tasa de cambio se guarda por transacción** y no se recalcula nunca.
- Registrar y consultar el mes en curso **funciona offline** y sincroniza después.

**Por definir en el spec:**

- ¿Puede un miembro editar transacciones de otros, o solo las suyas? (El rol
  miembro es "sus propias transacciones"; conviene precisar qué significa "propia"
  en un workspace compartido.)
- ¿Se permiten adjuntos (foto de recibo)? Si sí, ojo con offline y privacidad.
- ¿Cómo se maneja la resolución de conflictos si dos dispositivos editan la misma
  transacción offline y luego sincronizan?
- ¿Qué campos son obligatorios y cuáles opcionales?

---

### 5.6 Presupuesto 50/30/20 (budget) `[ESPECIFICADO — motor ya implementado]`

**Propósito.** Es el corazón de la app: responder, para el mes en curso, cuánto de
cada cubo del ingreso ya se consumió, cuánto queda disponible y qué alertas
disparar. La lógica de cálculo ya está implementada como funciones puras y probada
con una suite de tests.

**Qué ve y hace la persona:**

- Definir un **presupuesto mensual** con su **ingreso esperado** y los porcentajes
  de cada cubo (por defecto 50 / 30 / 20).
- Ver el **porcentaje consumido de cada cubo** (necesidad, deseo, ahorro) respecto
  del ingreso del mes.
- Ver el **disponible global** del mes.
- Opcionalmente, fijar **límites por categoría**.
- Recibir **alertas** cuando un cubo se acerca o pasa su límite.

**Reglas de cálculo (comportamiento observable):**

- El 50/30/20 se aplica **sobre el ingreso del mes**, no sobre el gasto.
- Existen tres **modos de "qué ingreso usar"**:
  - **Mayor (por defecto):** usa el mayor entre el ingreso real y el esperado.
    Útil al inicio del mes (antes de cobrar) y cuando hay bonos.
  - **Real:** usa solo el ingreso ya recibido. Estricto; a inicio de mes el
    dashboard muestra todo en 0 %.
  - **Esperado:** usa siempre el esperado. Consistencia visual.
- **Tratamiento de transferencias:**
  - Entre cuentas operativas (p. ej. banco -> efectivo): **neutras**, no afectan
    ningún cubo.
  - Hacia una cuenta de **ahorro**: cuentan como **consumo del cubo de ahorro**.
  - Entre dos cuentas de ahorro: **neutras** (reorganización interna).
  - Desde ahorro hacia una cuenta operativa (desahorro): **neutras** (no se
    "deshace" un aporte previo).
- El **ahorro del mes** = gastos categorizados con cubo "ahorro" + transferencias
  salientes hacia cuentas de ahorro. Así el cubo del 20 % siempre cuadra con lo
  efectivamente ahorrado, sin importar cómo lo registró la persona.
- Las **categorías archivadas siguen contando** en el cálculo histórico.
- Si llega una transacción con una categoría inexistente, se **ignora en
  silencio** (no rompe el dashboard).
- Si no hay ingreso (esperado 0 y real 0), los objetivos son 0 y el consumo se
  muestra como 0 % (nunca error ni "NaN").
- Los porcentajes del presupuesto deben **sumar 100** y no pueden ser negativos;
  si no, es un error de configuración que se avisa de inmediato.

**Lo que este módulo NO hace (a propósito):** no genera transacciones a partir de
las programadas, no envía notificaciones push (solo produce alertas como dato),
no convierte monedas (recibe montos ya en la moneda base), no calcula el saldo por
cuenta y no arma reportes multi-mes (para eso se recalcula mes por mes).

---

### 5.7 Transacciones programadas (scheduled) `[ESBOZADO]`

**Propósito.** Automatizar movimientos que se repiten, unificando dos casos en un
solo dominio.

**Qué puede hacer la persona (propuesta):**

- Programar transacciones **recurrentes** (sin fin, p. ej. sueldo, suscripción).
- Programar **cuotas** (total finito, con conteo de cuotas pagadas y restantes,
  p. ej. una compra en 12 pagos).
- Ver qué está por vencer y el avance de las cuotas.

**Reglas relevantes:**

- Cuando una programada **vence**, se genera una **transacción real** que el resto
  de la app (incluido el presupuesto) trata como cualquier otra.
- Recurrentes y cuotas comparten el mismo dominio; la diferencia es si tienen un
  total finito y un conteo.

**Por definir en el spec:**

- ¿Qué periodicidades se soportan (mensual, semanal, quincenal, anual)?
- ¿La generación de la transacción es automática al vencer, o requiere que la
  persona la confirme?
- ¿Qué pasa si el workspace está archivado cuando vence una programada?
- ¿Se puede editar una serie completa vs. una sola ocurrencia?
- ¿Cómo se comporta la generación estando offline?

---

### 5.8 Metas de ahorro (goals) `[ESBOZADO]`

**Propósito.** Ayudar a la persona a ahorrar hacia un objetivo concreto y ver si
va a buen ritmo.

**Qué puede hacer la persona (propuesta):**

- Crear una meta con **monto objetivo** y **fecha objetivo**.
- Ver su **avance** y el **ritmo** necesario (en camino / en riesgo).

**Reglas relevantes:**

- El seguimiento de ritmo compara lo ahorrado hasta ahora con lo que haría falta
  ahorrar por mes para llegar a la fecha objetivo.

**Por definir en el spec:**

- ¿Cómo se "alimenta" una meta? ¿Se vincula a una cuenta de ahorro, a
  transacciones etiquetadas, o a aportes manuales?
- ¿Las contribuciones a una meta cuentan en el cubo de ahorro del 50/30/20? (El
  motor ya contempla "contribuciones a metas modeladas como gasto con cubo
  ahorro"; conviene alinear.)
- ¿Qué pasa al cumplir o al vencer la fecha sin cumplir?
- ¿Las metas son por workspace o por persona?

---

### 5.9 División de gastos (splits) `[ESPECIFICADO — implementado]`

**Propósito.** Registrar un gasto que se reparte con otras personas y llevar la cuenta
de quién te debe cuánto, **sin distorsionar el 50/30/20**.

**El modelo contable, que es la decisión que ordena todo lo demás: solo tu parte
consume tu cubo.** Pagaste 900 y te deben 600 → tu cubo consumió 300. Eso se registra
como **dos** movimientos:

- un **gasto** de 300 en su categoría → consume el cubo que corresponde;
- una **transferencia** de 600 a una cuenta **"Por cobrar"** → los 900 realmente
  salieron de la cuenta que pagó.

Cobrar es la transferencia inversa: de "Por cobrar" a la cuenta que la persona elija.

**Por qué así y no como ingreso.** Registrar la devolución como ingreso era la
alternativa obvia y es incorrecta: el §1 calcula todo el método sobre el ingreso del
mes, así que inflarlo sube los tres objetivos y muestra más margen del que existe —
exactamente lo "engañoso" que el spec busca evitar.

**Qué puede hacer la persona:**

- **Dividir un gasto**: su parte, la cuenta que pagó, la categoría _de su parte_, y una
  fila por persona que le debe (nombre y monto). Hasta 20 personas por gasto.
- **Ver quién le debe**, con el total, y **marcar un cobro** eligiendo en qué cuenta
  entra la plata — alguien puede pagarle en efectivo algo que puso con tarjeta.

**Reglas:**

- **Su parte puede ser 0.** Pagar algo de otra persona en su totalidad es real; exigir
  un monto propio forzaría a registrar un gasto falso. En ese caso no se escribe fila
  de gasto y la deuda cuelga de la pata de la transferencia que aterriza en "Por
  cobrar".
- **Los deudores son texto libre, no usuarios de la app.** Las invitaciones no existen
  y están bloqueadas detrás de la graduación (§6), así que un deudor es un nombre que
  la gente del espacio escribe. Si fuera una persona invitada, los splits quedarían
  bloqueados igual que la colaboración.
- **Un gasto dividido sin nadie que deba es un gasto normal**, y se rechaza: la app ya
  tiene una pantalla para eso.
- **La cuenta "Por cobrar" es una por espacio**, la crea el sistema la primera vez que
  se necesita y su saldo **es** el total que le deben. No se ofrece en el formulario de
  cuentas: es una consecuencia de dividir un gasto, no algo que se configure.
- **Su tipo no es "ahorro"**, y eso es crítico: el motor alimenta el cubo de ahorro
  solo desde el tipo `savings`, así que prestarle plata a alguien no puede contar como
  haber ahorrado.
- **Aplica a cualquier espacio, no solo a los compartidos.** Dividir la cena con un
  amigo que no usa la app es el caso más común, y no requiere compartir nada.
- **Sin multi-moneda propia**: todo el gasto va en la moneda base del espacio, igual
  que el resto de los movimientos.
- Quien puede registrar movimientos puede dividir y cobrar (owner, admin, member); un
  observer lee. Un espacio archivado no acepta ni lo uno ni lo otro.
- **Un gasto dividido son tres escrituras que caen todas o ninguna** (el gasto, la
  transferencia y las filas de quién debe), y **cobrar dos veces se rechaza**: el
  segundo intento no mueve plata.

---

### 5.10 Reportes (reports) `[ESBOZADO]`

**Propósito.** Dar a la persona una vista del pasado: cómo le fue mes a mes.

**Qué puede hacer la persona (propuesta):**

- Ver **resúmenes mensuales** (por cubo, por categoría, por cuenta).
- Ver **comparativas** entre meses (p. ej. últimos 6 meses por cubo).
- **Exportar** su información en **CSV** y **PDF**.

**Reglas relevantes:**

- Los reportes históricos deben ser **coherentes siempre**, aunque después se
  archiven cuentas o se reorganicen categorías (principio de preservación del
  historial).
- Para vistas multi-mes, el cálculo del presupuesto se repite mes por mes.

**Por definir en el spec:**

- ¿Qué reportes concretos entran en el MVP?
- ¿La exportación es de un mes, de un rango o de todo?
- ¿El PDF es un resumen visual o un export "de datos"?
- ¿La exportación funciona offline?

---

### 5.11 Notificaciones (notifications) `[PARCIALMENTE ESPECIFICADO]`

**Propósito.** Avisar a la persona de lo que necesita saber, priorizando el canal
correcto según la sensibilidad.

**Comportamiento definido:**

- Las notificaciones de **colaboración** (invitación aceptada o rechazada, alguien
  fue agregado o quitado, etc.) se entregan **dentro de la app**.
- El **correo electrónico** se envía **únicamente** en acciones de alta
  sensibilidad: verificar un cambio de correo, avisar al correo anterior de ese
  cambio, confirmar la solicitud y la ejecución de la eliminación de cuenta,
  notificar una transferencia de propiedad, enviar una invitación y enviar el
  enlace de recuperación de contraseña. **Ninguna otra acción genera correo.**

**Alertas financieras (propuesta):**

- La app muestra alertas in-app cuando un **cubo llega a su límite**, cuando una
  **cuota está por vencer** o cuando una **meta está en riesgo**.
- Estas alertas nacen como **dato** (las produce el motor de presupuesto y otros
  módulos); una capa de presentación decide cómo mostrarlas.

**Por definir en el spec:**

- ¿Hay notificaciones push, o solo badges/alertas dentro de la app? (El motor solo
  produce el dato; el canal está por decidir.)
- ¿La persona puede configurar qué alertas recibir?
- ¿Umbral configurable para "cubo al límite"?

---

## 6. Límites del plan actual

Por ahora existe un **único plan**, sin cobros ni facturación, y por lo tanto
**sin límites comerciales**. Lo único que existe es un tope técnico:

- Cada persona puede tener hasta **20 espacios propios** (de los que es
  propietaria). No es un límite de producto: es un guardarraíl contra el abuso.
  Esta es una ruta de creación self-service sobre un proyecto de base de datos
  compartido, y sin techo un bucle —un reintento, un formulario trabado, alguien
  curioso— escribe filas sin fin en una base que comparten las demás apps. El
  número es deliberadamente generoso para una persona real e inútil para un
  script.
- Los espacios **archivados y eliminados no cuentan**, así que archivar libera
  cupo de verdad.
- Pertenecer a espacios de otras personas **nunca** consume tu cupo: se cuentan
  solo los que sos propietaria.
- **No hay límite** de integrantes por espacio compartido.
- Al intentar crear uno por encima del tope, la app lo **rechaza** y ofrece
  archivar o eliminar uno existente.

> **Nota de producto.** Este documento decía antes «máximo 1 espacio personal y 2
> compartidos». Nunca se implementó, y se descartó a propósito: un límite así
> tiene sentido cuando separa un plan gratuito de uno pago, y hoy no hay planes.
> Una restricción que no vende nada solo molesta a la persona que la encuentra.
> Cuando existan cobros, el límite comercial se define acá y recién entonces se
> implementa.
>
> El espacio **personal** sigue siendo único por otra razón, que no es un límite
> de plan sino una invariante del modelo: es el punto de partida que la app
> resuelve al iniciar sesión, y un segundo haría esa resolución ambigua. Ver §5.2.

---

## 7. Fuera de alcance (por ahora)

- Autenticación con proveedores distintos de Google (Apple, Facebook, etc.).
- Acceso sin contraseña por enlace mágico.
- Verificación en dos pasos.
- Inicio de sesión único empresarial (SSO).
- Vincular más de un método de acceso a una misma cuenta.
- Convertir un workspace personal en compartido o viceversa.
- Permisos más finos que los cuatro roles definidos.
- Cobros, planes de pago y facturación.
- Avisos de inicio de sesión desde dispositivos nuevos.

---

## 8. Casos borde ya definidos (autenticación y workspaces)

Estos comportamientos ya están decididos y deben cumplirse:

- Alguien acepta una invitación pero se registró con un correo distinto al
  invitado -> no se une automáticamente; debe usar el correo exacto.
- Una persona invitada que está en período de gracia de eliminación acepta una
  invitación -> aceptar **reactiva** su cuenta y **cancela** la eliminación,
  avisándole del cambio.
- La única propietaria de un workspace sin más integrantes intenta "salir" -> no se
  permite; solo puede archivar o eliminar el espacio.
- Dos administradores cambian el rol de la misma persona a la vez -> gana el último
  cambio, y ambos quedan registrados.
- Se intenta reutilizar un enlace de invitación ya aceptado o caducado -> se rechaza
  con un mensaje claro.
- Se intenta invitar a alguien que ya es integrante -> se rechaza sin duplicar.
- Una administradora pierde su rol después de haber enviado una invitación aún no
  aceptada -> la invitación sigue válida hasta caducar o ser revocada.
- Alguien cambia su contraseña con sesión abierta en otro dispositivo -> esa otra
  sesión se invalida.
- Se intenta cambiar el correo a uno ya registrado -> se rechaza con mensaje
  genérico.
- En un workspace archivado, alguien intenta registrar una transacción -> se
  bloquea con mensaje claro.
- Dos propietarios (en transición) intentan transferir la propiedad a la vez a
  personas distintas -> la segunda operación falla porque la primera ya cambió quién
  es propietario.
- Una invitación cuyo workspace fue eliminado antes de aceptarse -> queda caducada
  automáticamente.
- Alguien sin conexión acepta una invitación -> la acción se completa al reconectar;
  si el enlace caducó mientras tanto, falla con aviso.
- Alguien cancela el inicio de sesión con Google a mitad del proceso -> vuelve a la
  pantalla de acceso sin que se cree ni modifique cuenta alguna.
- Se intenta crear un workspace por encima del límite -> se rechaza, ofreciendo
  archivar o eliminar uno existente.
- Una persona con cuenta de Google intenta cambiar contraseña/correo o pide
  recuperación -> esas opciones no aplican; la recuperación no envía correo, pero la
  app responde con el mismo mensaje genérico.
- Al ejecutarse la eliminación definitiva de una cuenta -> las invitaciones enviadas
  quedan revocadas y las recibidas quedan caducadas.

---

## 9. Decisiones pendientes / preguntas abiertas (consolidado)

Lista de trabajo para cerrar el comportamiento de los módulos aún esbozados antes
(o durante) su spec.

**Esta lista está atrasada respecto del código.** Varias de estas preguntas ya
quedaron respondidas por la implementación y por decisiones tomadas sobre la marcha
(los tipos de cuenta y su relación con el motor, la inmutabilidad de la moneda, el set
de categorías por defecto, el alcance de editar movimientos propios, qué reportes y qué
exportaciones entran, el canal de las alertas financieras). Solo el bloque de **Splits**
fue barrido y marcado; el resto sigue escrito como estaba y hay que revisarlo módulo por
módulo contra lo que el código ya hace, en vez de asumir que una pregunta sigue abierta
porque figura acá.

**Cuentas**

- Definir los tipos exactos y cómo se relaciona el tipo "ahorro" con el motor.
- ¿La moneda de una cuenta es inmutable tras crearla?
- Comportamiento al archivar una cuenta con saldo.

**Categorías**

- ¿El cubo lo lleva la categoría padre, la subcategoría o ambas?
- ¿Set de categorías por defecto al crear un workspace?
- Efecto de reasignar el cubo de una categoría sobre reportes históricos.

**Transacciones**

- Alcance de "editar transacciones propias" en un workspace compartido.
- ¿Adjuntos (recibos)? Implicaciones de offline y privacidad.
- Estrategia de resolución de conflictos en edición offline concurrente.
- Campos obligatorios vs. opcionales.

**Programadas**

- Periodicidades soportadas.
- Generación automática vs. confirmación manual al vencer.
- Comportamiento con workspace archivado y estando offline.
- Editar serie completa vs. una ocurrencia.

**Metas**

- Cómo se alimenta una meta (cuenta de ahorro / etiquetas / aportes manuales).
- Relación entre aportes a metas y el cubo de ahorro del 50/30/20.
- Comportamiento al cumplir o al vencer.

**Splits** — `resuelto`, ver §5.9

- El modelo quedó definido e implementado: **solo tu parte consume tu cubo**, el resto
  va a una cuenta "Por cobrar" cuyo saldo es lo que te deben, y se salda con la
  transferencia inversa a la cuenta que la persona elija. Los deudores son texto libre,
  no usuarios de la app.

**Reportes**

- Qué reportes entran en el MVP; alcance de la exportación (mes/rango/todo).
- Naturaleza del PDF (visual vs. datos). Exportación offline.

**Notificaciones**

- Canal de las alertas financieras (push vs. solo in-app).
- Configurabilidad de alertas y umbrales.

---

## 10. Glosario

- **Workspace / espacio financiero:** contenedor de toda la información financiera;
  dueño de los datos.
- **Cubo (bucket):** cada una de las tres categorías del 50/30/20 —
  necesidad, deseo, ahorro.
- **Ingreso esperado vs. real:** el planeado para el mes vs. el efectivamente
  recibido; el modo de presupuesto decide cuál se usa.
- **Cuenta de ahorro (savings):** tipo de cuenta hacia la cual una transferencia
  cuenta como ahorro consumido.
- **Transferencia:** movimiento entre dos cuentas, modelado como un par atado de
  dos filas.
- **Cuota:** transacción programada con total finito y conteo de pagadas/restantes.
- **Recurrente:** transacción programada sin fin.
- **Archivar (soft delete):** dejar algo fuera de uso preservando su historial, sin
  borrarlo físicamente.
- **Período de gracia:** ventana de 30 días tras solicitar eliminar la cuenta,
  durante la cual la persona puede arrepentirse.
- **Usuario eliminado:** atribución que reemplaza a una persona cuyos registros
  permanecen en un workspace compartido tras eliminar su cuenta.
