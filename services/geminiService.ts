
import { GoogleGenAI, Type } from "@google/genai";

// Standardized initialization per coding guidelines
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export interface ParsedTimeEntry {
  project: string;
  task: string;
  duration: number;
  notes?: string;
}

export const parseSmartEntry = async (input: string): Promise<ParsedTimeEntry | null> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Parse this time tracking input: "${input}". 
      Extract the project name (if any, default to "General"), the specific task description, and the duration in hours. 
      If duration is mentioned in minutes (e.g. 30m), convert it to decimal hours (0.5).
      Also extract any extra context or details as 'notes'.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            project: { type: Type.STRING, description: "Name of the project" },
            task: { type: Type.STRING, description: "Description of the task" },
            duration: { type: Type.NUMBER, description: "Duration in decimal hours" },
            notes: { type: Type.STRING, description: "Additional details or comments" },
          },
          required: ["project", "task", "duration"],
        },
      },
    });

    // Directly access .text property from GenerateContentResponse
    const text = response.text.trim();
    return JSON.parse(text) as ParsedTimeEntry;
  } catch (error) {
    console.error("Gemini Parsing Error:", error);
    return null;
  }
};

export const getInsights = async (entries: any[]): Promise<string> => {
  try {
    const context = JSON.stringify(entries);
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Analyze these time logs and provide 2-3 concise bullet points of productivity insights or patterns: ${context}`,
      config: {
          systemInstruction: "You are a productivity coach. Be concise, encouraging, and data-driven.",
      }
    });
    // Directly access .text property from GenerateContentResponse
    return response.text;
  } catch (error) {
    return "Keep up the great work! Consistent tracking is the first step to optimization.";
  }
};
