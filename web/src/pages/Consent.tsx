import { Link } from 'react-router-dom'
import { Button, Card } from '../components/ui'

export function ConsentPage() {
  return <main className="consent-page">
    <Card className="consent-document" aria-labelledby="consent-title">
      <header className="consent-document-header">
        <p className="consent-institution">UNIVERSIDAD CONTINENTAL</p>
        <p className="consent-school">ESCUELA DE POSGRADO · MAESTRÍA EN INTELIGENCIA ARTIFICIAL</p>
        <h1 id="consent-title">CONSENTIMIENTO INFORMADO PARA PARTICIPAR EN UNA INVESTIGACIÓN</h1>
        <p className="consent-subtitle">(Registro de Usuario en Plataforma Educativa)</p>
        <dl className="consent-study-details">
          <div><dt>Título del estudio:</dt><dd>Plataforma con tutor adaptativo de inteligencia artificial frente a la enseñanza habitual en la Unidad 4 de Principios del Auxilio Inmediato. Estudio piloto sobre sobredependencia cognitiva y razonamiento clínico en estudiantes de Tecnología Médica.</dd></div>
          <div><dt>Investigadores:</dt><dd>Oscar Alex Rodríguez Díaz y Danilo Aldo Baltazar Chacón.</dd></div>
          <div><dt>Curso:</dt><dd>Principios del Auxilio Inmediato (24UC00818) · Año: 2026.</dd></div>
        </dl>
      </header>

      <hr className="consent-divider" />

      <section aria-labelledby="consent-section-1">
        <h2 id="consent-section-1">1. INVITACIÓN Y PROPÓSITO</h2>
        <p>Antes de crear su cuenta y acceder a la plataforma, se le invita a autorizar voluntariamente el uso de sus datos para una investigación educativa. El estudio describirá los cambios en el razonamiento clínico autónomo y en la aceptación de sugerencias simuladas erróneas durante la Unidad 4, además de documentar el desempeño por tema y la factibilidad tecnológica de esta herramienta. Si tiene alguna duda antes de continuar, puede consultar con el equipo investigador o la persona encargada de la inducción.</p>
      </section>

      <section aria-labelledby="consent-section-2">
        <h2 id="consent-section-2">2. ACTIVIDADES DEL ESTUDIO Y EVALUACIONES</h2>
        <p>El estudio compara dos secciones de Tecnología Médica (una con clases habituales y otra con el apoyo de esta plataforma), ambas bajo los mismos objetivos, contenidos, docente y horario (90 minutos por sesión, de 8:30 a 10:00 p. m.) a lo largo de cuatro sesiones:</p>
        <ul>
          <li>Tema 1: Heridas y hemorragias.</li>
          <li>Tema 2: Quemaduras.</li>
          <li>Tema 3: Fracturas, esguinces y luxaciones, vendajes, inmovilización y traslado.</li>
          <li>Tema 4: Cuerpos extraños en nariz y oído.</li>
        </ul>
        <p>El proceso incluye:</p>
        <ul>
          <li>Pretest (antes de la primera clase): Evaluación presencial, escrita y supervisada de 50 minutos (cuatro casos clínicos, una tarea conductual y un breve autoinforme).</li>
          <li>Pruebas por sesión (E1–E4): Evaluación de 10 preguntas (15 minutos) al finalizar cada clase.</li>
          <li>Postest (3 a 7 días después de E4): Evaluación presencial equivalente al pretest (50 minutos).</li>
        </ul>
        <p><strong>Nota importante:</strong> Las pruebas de investigación y las actividades dentro de la plataforma no forman parte de las notas oficiales del curso.</p>
      </section>

      <section aria-labelledby="consent-section-3">
        <h2 id="consent-section-3">3. USO DE INTELIGENCIA ARTIFICIAL Y SUGERENCIAS SIMULADAS</h2>
        <p>En esta plataforma usted resolverá escenarios ficticios escribiendo qué haría primero y su justificación. Un modelo de lenguaje interpretará sus respuestas para guiar una secuencia de mensajes socráticos previamente revisados por especialistas, mientras que un motor de reglas controlará la seguridad pedagógica.</p>
        <p>Advertencias de uso:</p>
        <ul>
          <li>Esta plataforma es exclusivamente educativa y no brinda atención ni asesoría clínica real.</li>
          <li>Por seguridad y privacidad, NO ingrese nombres propios, números de documento ni datos personales suyos o de terceros en los cuadros de texto.</li>
          <li>Durante las tareas conductuales (pretest/postest) se presentarán recomendaciones deliberadamente incorrectas como parte del diseño experimental; al finalizar el estudio se explicarán los principios clínicos correctos.</li>
          <li>En las evaluaciones presenciales no está permitido el uso de IA, apuntes ni teléfonos móviles.</li>
        </ul>
      </section>

      <section aria-labelledby="consent-section-4">
        <h2 id="consent-section-4">4. RECOPILACIÓN DE DATOS DE USO DE LA PLATAFORMA (TELEMETRÍA)</h2>
        <p>Al registrarse y utilizar la plataforma, usted autoriza que el sistema registre y recopile automáticamente datos sobre su interacción y uso con fines estrictamente científicos y de mejora educativa. Esto incluye:</p>
        <ul>
          <li>Respuestas escritas, justificaciones e interacciones con el tutor de IA.</li>
          <li>Tiempos de respuesta, duración de las sesiones, frecuencia de acceso y navegación entre pantallas.</li>
          <li>Elecciones tomadas ante las sugerencias del sistema y progreso por cada tema.</li>
          <li>Registros técnicos básicos (como eventos de error o incidencias de conexión) para evaluar la factibilidad de la plataforma.</li>
        </ul>
      </section>

      <section aria-labelledby="consent-section-5">
        <h2 id="consent-section-5">5. OBSERVACIÓN EN AULA</h2>
        <p>Un observador externo al equipo docente podrá realizar recuentos generales y anónimos sobre la participación en el aula. No se registrarán nombres ni se grabará audio o video.</p>
      </section>

      <section aria-labelledby="consent-section-6">
        <h2 id="consent-section-6">6. RIESGOS Y BENEFICIOS</h2>
        <p>Los riesgos son mínimos e incluyen posible fatiga cognitiva, preocupación por el desempeño, incidencias técnicas o un riesgo residual de acceso no autorizado a la información (mitigado mediante protocolos de seguridad informática). No recibirá compensación económica ni beneficios académicos directos, pero su participación ayudará a mejorar la enseñanza clínica.</p>
      </section>

      <section aria-labelledby="consent-section-7">
        <h2 id="consent-section-7">7. PRIVACIDAD Y PROTECCIÓN DE DATOS</h2>
        <ul>
          <li>Seudonimización: Para registrarse y usar la plataforma se le asignará un código de investigación. El sistema NO le solicitará su nombre real, correo institucional ni número de matrícula.</li>
          <li>Confidencialidad: La tabla que vincula su código con su identidad se almacenará fuera de la plataforma, por separado y con acceso restringido.</li>
          <li>Conservación y retiro: Los datos codificados se conservarán de forma segura hasta por cinco años tras el cierre del estudio, divulgándose únicamente resultados estadísticos agregados. Usted podrá solicitar el retiro de sus datos identificables antes de que se realice la anonimización irreversible al finalizar el estudio.</li>
        </ul>
      </section>

      <section aria-labelledby="consent-section-8">
        <h2 id="consent-section-8">8. PARTICIPACIÓN VOLUNTARIA</h2>
        <p>Su participación es completamente libre y voluntaria. Rechazar el consentimiento o retirarse posteriormente no afectará sus calificaciones, asistencia ni su relación con la Universidad Continental. Si decide no participar en la investigación, no complete el registro en esta plataforma; podrá continuar con las actividades académicas regulares de su sección sin que sus datos sean incluidos en el análisis. El docente del curso solo tendrá acceso a resultados generales una vez concluida la asignatura.</p>
      </section>

      <section aria-labelledby="consent-section-9">
        <h2 id="consent-section-9">9. CONTACTOS Y APROBACIÓN ÉTICA</h2>
        <ul>
          <li>Responsable institucional de datos: [Completar antes de publicar]</li>
          <li>Contacto del equipo investigador: [Completar correo/teléfono]</li>
          <li>Contacto del Comité de Ética: [Completar correo/teléfono]</li>
          <li>Código y fecha de aprobación ética: [Completar código y fecha]</li>
        </ul>
      </section>

      <hr className="consent-divider" />

      <section aria-labelledby="consent-section-10">
        <h2 id="consent-section-10">10. DECLARACIÓN Y ACEPTACIÓN DE TÉRMINOS</h2>
        <p>Al completar el formulario de registro y crear su cuenta en esta plataforma, usted declara haber leído y comprendido toda la información anterior y acepta voluntariamente participar en la investigación, autorizando la recopilación y el tratamiento de sus datos de uso conforme a los términos expuestos en este documento.</p>
        <p>Si no desea participar en el estudio, simplemente cierre esta página y no realice el registro.</p>
      </section>

      <div className="consent-page-actions"><Link to="/login?mode=sign-up"><Button variant="outline">Volver al registro</Button></Link></div>
    </Card>
  </main>
}
