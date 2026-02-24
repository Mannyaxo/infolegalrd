"use client";

const NOMBRE_ARCHIVO = "Acuerdo_Terminacion_Colaboracion_Independiente_RD.txt";

const CONTENIDO = `ACUERDO DE TERMINACIÓN DE COLABORACIÓN INDEPENDIENTE

En la ciudad de _______________, República Dominicana, a los ______ días del mes de ______________ de 20______, comparecen:

Por una parte, _______________________________ (nombre completo), con cédula de identidad y electoral No. _______________, en lo sucesivo “EL CONTRATANTE”;

Y por la otra parte, _______________________________ (nombre completo), con cédula de identidad y electoral No. _______________, en lo sucesivo “EL COLABORADOR”.

Manifiestan que han convenido en poner fin a la relación de colaboración independiente que mantenían, en los siguientes términos:

PRIMERO: Las partes reconocen que la relación entre ellas era de naturaleza civil/comercial y de colaboración independiente, sin subordinación laboral, por lo que no se aplica el Código Laboral de la República Dominicana en lo relativo a despido o indemnizaciones laborales.

SEGUNDO: El presente acuerdo pone fin de mutuo acuerdo a dicha colaboración a partir del día ______ de ______________ de 20______, sin que ninguna de las partes deba indemnización a la otra por concepto de terminación.

TERCERO: El CONTRATANTE se compromete a entregar al COLABORADOR, en un plazo no mayor de ______ días, los pagos o liquidaciones que correspondan por servicios ya prestados y no pagados hasta la fecha de terminación, según lo acordado entre las partes.

CUARTO: Ambas partes se deslindan mutuamente de reclamos futuros relacionados con la colaboración que termina por el presente acuerdo.

QUINTO: El presente documento se firma en dos ejemplares de un mismo tenor y a un solo efecto.

_________________________          _________________________
EL CONTRATANTE                      EL COLABORADOR

_________________________          _________________________
Cédula No.                          Cédula No.

--- 
NOTA: Este documento es un modelo de referencia con fines informativos. No constituye asesoramiento legal. Debe adaptarse a cada caso y es recomendable que un abogado colegiado revise o redacte el documento según su situación específica. InfoLegal RD.
`;

export function PlantillaAcuerdoTerminacion() {
  const descargar = () => {
    const blob = new Blob([CONTENIDO], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = NOMBRE_ARCHIVO;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mt-4">
      <pre className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-300 sm:text-sm">
        {CONTENIDO}
      </pre>
      <button
        type="button"
        onClick={descargar}
        className="mt-3 rounded-lg bg-legal-dark px-4 py-2 text-sm font-medium text-white hover:opacity-90 dark:bg-primary-600"
      >
        Descargar plantilla (.txt)
      </button>
    </div>
  );
}
