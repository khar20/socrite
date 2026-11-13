import { Link } from 'react-router-dom'
import { Button, Card } from '../components/ui'

export function ConsentPage() {
  return <main className="consent-page">
    <Card className="consent-document">
      <span className="eyebrow">Información para estudiantes</span>
      <h1>Consentimiento informado para uso de sus datos</h1>
      <p className="muted-text">Documento informativo de Socrite · Versión de referencia</p>
      <section><h2>1. Finalidad</h2><p>Los datos generados durante el uso de Socrite podrán utilizarse con fines de investigación educativa para comprender y mejorar los procesos de enseñanza y aprendizaje.</p></section>
      <section><h2>2. Datos que podrían utilizarse</h2><p>Esto puede incluir información de cuenta, participación en cursos, respuestas a actividades, progreso académico y uso de las herramientas de aprendizaje. El contenido concreto y el alcance de cualquier estudio deben ser definidos por la institución responsable.</p></section>
      <section><h2>3. Cómo se tratarán los datos</h2><p>Los datos se analizarán con medidas de confidencialidad y, cuando sea posible, de forma agregada o desidentificada. El acceso estará limitado a personas autorizadas para los fines educativos y de investigación informados.</p></section>
      <section><h2>4. Participación y consultas</h2><p>La participación en usos de investigación debe ser voluntaria. Puede consultar a la institución educativa responsable para conocer el protocolo aplicable, solicitar información sobre sus datos o comunicar una pregunta. La institución debe completar aquí sus datos de contacto y los procedimientos vigentes.</p></section>
      <section><h2>5. Aceptación</h2><p>Al marcar la casilla durante el registro, confirma que leyó esta información y acepta el uso de sus datos de estudiante con fines de investigación educativa descrito aquí.</p></section>
      <div className="consent-page-actions"><Link to="/login"><Button variant="outline">Volver al registro</Button></Link></div>
    </Card>
  </main>
}
