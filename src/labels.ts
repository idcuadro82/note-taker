/** Fixed words used in the generated files, in the language of the meeting. */
export interface Labels {
  languageName: string;
  me: string;
  others: string;
  transcript: string;
  summary: string;
  keyPoints: string;
  decisions: string;
  actionItems: string;
  openQuestions: string;
  due: string;
}

const LABELS: Record<string, Labels> = {
  en: {
    languageName: "English",
    me: "Me",
    others: "Others",
    transcript: "Transcript",
    summary: "Summary",
    keyPoints: "Key points",
    decisions: "Decisions",
    actionItems: "Action items",
    openQuestions: "Open questions",
    due: "due",
  },
  es: {
    languageName: "Spanish",
    me: "Yo",
    others: "Otros",
    transcript: "Transcripción",
    summary: "Resumen",
    keyPoints: "Puntos clave",
    decisions: "Decisiones",
    actionItems: "Tareas",
    openQuestions: "Preguntas abiertas",
    due: "fecha",
  },
};

/** Falls back to English for languages without a translation. */
export function labelsFor(language: string): Labels {
  return LABELS[language] ?? LABELS.en;
}
