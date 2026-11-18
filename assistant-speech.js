export function createAssistantSpeechRecognition() {
  const SpeechRecognitionApi = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (typeof SpeechRecognitionApi !== "function") return null;
  const recognition = new SpeechRecognitionApi();
  recognition.lang = "pt-BR";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  return recognition;
}
