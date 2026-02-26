"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { QueryPanel } from "@/components/chat/QueryPanel";

const AREAS = [
  { id: "laboral", icon: "👔", name: "Derecho Laboral", desc: "Contratos, despidos, prestaciones, preaviso", query: "¿Cuáles son los derechos laborales de un trabajador en caso de despido injustificado en República Dominicana?" },
  { id: "familia", icon: "👨‍👩‍👧", name: "Derecho de Familia", desc: "Divorcios, custodia, adopción, pensiones", query: "¿Cuáles son los requisitos para un divorcio de mutuo acuerdo en República Dominicana?" },
  { id: "inmobiliario", icon: "🏠", name: "Derecho Inmobiliario", desc: "Títulos, arrendamientos, registro, compraventa", query: "¿Cómo funciona el proceso de compraventa de inmuebles en República Dominicana?" },
  { id: "comercial", icon: "🏢", name: "Derecho Comercial", desc: "SRL, SA, deudas, contratos, quiebras", query: "¿Qué se necesita para constituir una SRL en República Dominicana?" },
  { id: "civil", icon: "⚖️", name: "Derecho Civil", desc: "Obligaciones, herencias, contratos, daños", query: "¿Cómo funciona el proceso de sucesión y herencia en República Dominicana?" },
  { id: "penal", icon: "🚨", name: "Derecho Penal", desc: "Delitos, procesos, derechos del imputado", query: "¿Cuáles son los derechos del imputado en el proceso penal dominicano?" },
  { id: "constitucional", icon: "🏛️", name: "Derecho Constitucional", desc: "Derechos fundamentales, amparo, garantías", query: "¿Qué es el recurso de amparo y cuándo se puede utilizar en RD?" },
];

const FAQS = [
  { q: "¿InfoLegal RD reemplaza a un abogado?", a: "No. InfoLegal RD ofrece orientación educativa e informativa. Para representación legal o asesoría formal, siempre es recomendable consultar un abogado colegiado en el Colegio de Abogados de la República Dominicana." },
  { q: "¿En qué leyes se basa el sistema?", a: "El sistema está indexado con la Constitución dominicana, Código Civil, Código Laboral (Ley 16-92), Código Penal, Código de Comercio, y más de 50 leyes especiales vigentes en RD." },
  { q: "¿Qué es el modo Máxima Confiabilidad?", a: "Este modo aplica una capa adicional de verificación con referencias específicas a artículos legales y revisión de jurisprudencia aplicable. Ideal para consultas técnicas o de mayor sensibilidad." },
  { q: "¿Mis consultas son confidenciales?", a: "Las consultas no se almacenan con datos personales identificables. Recomendamos no incluir información personal sensible como cédulas o nombres en tus preguntas." },
  { q: "¿El servicio tiene costo?", a: "InfoLegal RD es completamente gratuito para consultas informativas. Funcionalidades avanzadas como plantillas legales personalizadas y análisis extendido pueden requerir registro." },
];

function CursorGlow() {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const onMove = (e: MouseEvent) => setPos({ x: e.clientX, y: e.clientY });
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);
  return (
    <div
      className="cursor-glow"
      style={{ left: pos.x, top: pos.y }}
      aria-hidden
    />
  );
}

export default function HomePage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);
  const [suggestedQuery, setSuggestedQuery] = useState<string | null>(null);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const fillFromArea = (query: string) => {
    setSuggestedQuery(query);
    scrollTo("panel");
  };

  return (
    <div className="page-v2 min-h-screen">
      <CursorGlow />

      <nav className="nav-v2">
        <Link href="/" className="logo-v2">
          <div className="logo-mark">⚖️</div>
          <span className="logo-type">Info<span>Legal</span> RD</span>
        </Link>
        <ul className="nav-center">
          <li><a href="#consulta" onClick={(e) => { e.preventDefault(); scrollTo("consulta"); }}>Consultar</a></li>
          <li><a href="#consulta">Áreas</a></li>
          <li><a href="#como-funciona" onClick={(e) => { e.preventDefault(); scrollTo("como-funciona"); }}>Proceso</a></li>
          <li><a href="#faqs" onClick={(e) => { e.preventDefault(); scrollTo("faqs"); }}>FAQs</a></li>
          <li><Link href="/plantillas">Plantillas</Link></li>
        </ul>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Link href="/login" className="btn-ghost">Iniciar sesión</Link>
          <button type="button" className="btn-sage" onClick={() => scrollTo("consulta")}>
            Consultar ahora
          </button>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-inner">
          <div className="hero-label">
            <span className="live-dot" />
            Sistema activo · IA Legal Dominicana
          </div>
          <h1 className="hero-title">
            <span className="dim">Derecho</span> dominicano
            <br />
            al alcance de <span className="italic">todos.</span>
          </h1>
          <p className="hero-sub">
            Consulta normativa legal de la República Dominicana analizada por inteligencia artificial. Información estructurada, clara y fundamentada en legislación vigente.
          </p>
          <div className="hero-actions">
            <button type="button" className="btn-primary" onClick={() => scrollTo("consulta")}>
              ⚖️ Hacer una consulta
            </button>
            <button type="button" className="btn-outline" onClick={() => scrollTo("como-funciona")}>
              Ver cómo funciona
            </button>
          </div>
          <div className="stats-bar">
            <div className="stats-bar-inner">
              <div className="stat">
                <div className="stat-n">+50<span></span></div>
                <div className="stat-l">Leyes indexadas</div>
              </div>
              <div className="stat">
                <div className="stat-n">24<span>/7</span></div>
                <div className="stat-l">Disponible siempre</div>
              </div>
              <div className="stat">
                <div className="stat-n">100<span>%</span></div>
                <div className="stat-l">Gratuito</div>
              </div>
              <div className="stat">
                <div className="stat-n">RD<span></span></div>
                <div className="stat-l">Normativa local</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="query-section" id="consulta">
        <div className="qs-left">
          <div className="qs-tag">Áreas de práctica</div>
          <h2 className="qs-title">¿En qué área necesitas orientación?</h2>
          <p className="qs-desc">
            Selecciona un área o escribe directamente tu consulta. Cubrimos las principales ramas del derecho dominicano.
          </p>
          <div className="areas-list">
            {AREAS.map((area) => (
              <div
                key={area.id}
                role="button"
                tabIndex={0}
                className="area-row"
                onClick={() => fillFromArea(area.query)}
                onKeyDown={(e) => e.key === "Enter" && fillFromArea(area.query)}
              >
                <div className="area-row-icon">{area.icon}</div>
                <div className="area-row-text">
                  <div className="area-row-name">{area.name}</div>
                  <div className="area-row-desc">{area.desc}</div>
                </div>
                <div className="area-row-arrow">→</div>
              </div>
            ))}
          </div>
        </div>
        <QueryPanel suggestedQuery={suggestedQuery} onSuggestionApplied={() => setSuggestedQuery(null)} />
      </section>

      <section className="section-how" id="como-funciona">
        <div className="inner">
          <div className="section-eyebrow">Proceso</div>
          <h2 className="section-heading">Cómo funciona InfoLegal RD</h2>
          <div className="how-grid">
            <div className="how-card">
              <div className="how-num">01</div>
              <div className="how-icon">✍️</div>
              <div className="how-title">Escribe tu consulta</div>
              <p className="how-desc">
                Describe tu situación en lenguaje cotidiano o elige un ejemplo. No necesitas conocimientos legales previos.
              </p>
            </div>
            <div className="how-card">
              <div className="how-num">02</div>
              <div className="how-icon">🔍</div>
              <div className="how-title">IA analiza la normativa</div>
              <p className="how-desc">
                El sistema cruza tu pregunta con la Constitución dominicana, Códigos Civil, Laboral, Penal y leyes especiales vigentes.
              </p>
            </div>
            <div className="how-card">
              <div className="how-num">03</div>
              <div className="how-icon">📋</div>
              <div className="how-title">Recibes orientación estructurada</div>
              <p className="how-desc">
                Respuesta organizada con marco legal aplicable, artículos relevantes, preguntas clave y próximos pasos recomendados.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section-faq" id="faqs">
        <div className="inner">
          <div>
            <div className="section-eyebrow">Preguntas frecuentes</div>
            <h2 className="section-heading" style={{ fontSize: 42 }}>Lo que necesitas saber</h2>
          </div>
          <div className="faq-items">
            {FAQS.map((faq, i) => (
              <div
                key={i}
                className={`faq-item ${openFaq === i ? "open" : ""}`}
              >
                <button
                  type="button"
                  className="faq-btn"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                >
                  {faq.q}
                  <div className="faq-plus">+</div>
                </button>
                <div className="faq-ans">{faq.a}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="footer-v2">
        <div className="footer-top">
          <div>
            <div className="logo-v2" style={{ alignItems: "center", gap: 12 }}>
              <div className="logo-mark">⚖️</div>
              <span className="logo-type">Info<span>Legal</span> RD</span>
            </div>
            <p className="footer-desc">
              Orientación legal informativa para la República Dominicana, impulsada por inteligencia artificial. No constituye asesoría legal profesional.
            </p>
          </div>
          <div>
            <div className="footer-col-title">Navegación</div>
            <ul className="footer-links-col">
              <li><Link href="/">Inicio</Link></li>
              <li><a href="#consulta" onClick={(e) => { e.preventDefault(); scrollTo("consulta"); }}>Hacer consulta</a></li>
              <li><a href="#consulta">Áreas legales</a></li>
              <li><a href="#faqs" onClick={(e) => { e.preventDefault(); scrollTo("faqs"); }}>Preguntas frecuentes</a></li>
            </ul>
          </div>
          <div>
            <div className="footer-col-title">Recursos</div>
            <ul className="footer-links-col">
              <li><Link href="/plantillas">Plantillas legales</Link></li>
              <li><a href="#">Glosario jurídico</a></li>
              <li><a href="#">Legislación RD</a></li>
              <li><a href="#">Blog</a></li>
            </ul>
          </div>
          <div>
            <div className="footer-col-title">Legal</div>
            <ul className="footer-links-col">
              <li><a href="#">Términos de uso</a></li>
              <li><a href="#">Privacidad</a></li>
              <li><a href="#">Aviso legal</a></li>
              <li><a href="#">Contacto</a></li>
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          <span className="footer-copy">© 2025 InfoLegal RD. Todos los derechos reservados.</span>
          <span className="footer-note">
            Orientación educativa únicamente. No constituye asesoría legal ni relación abogado-cliente.
          </span>
        </div>
      </footer>
    </div>
  );
}
