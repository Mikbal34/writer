/**
 * Prompt for AI-assisted academic search query generation.
 */

export function buildResearchPrompt(
  description: string,
  projectContext?: {
    topic?: string
    existingBibliography?: string[]
  }
): { system: string; user: string } {
  const system = `You are an academic research assistant. Your task is to generate optimized search queries for academic databases (OpenAlex, Semantic Scholar, CrossRef, Google Books).

Rules:
- Generate 3-5 diverse search queries that approach the topic from different angles
- Use English for international sources, Turkish for Turkish-specific topics
- Include broader and narrower queries to maximize coverage
- Consider synonyms, related concepts, and key authors in the field
- Output ONLY valid JSON, nothing else`

  let userPrompt = `The user needs academic sources about:
"${description}"
`

  if (projectContext?.topic) {
    userPrompt += `\nProject topic: ${projectContext.topic}`
  }

  if (projectContext?.existingBibliography?.length) {
    userPrompt += `\nAlready has these sources (avoid duplicates):\n${projectContext.existingBibliography.slice(0, 20).map((b) => `- ${b}`).join('\n')}`
  }

  userPrompt += `

Return JSON in this format:
{
  "queries": [
    {
      "text": "the search query",
      "providers": ["openalex", "semantic_scholar"],
      "reasoning": "why this query"
    }
  ],
  "suggestedTypes": ["makale", "kitap"]
}`

  return { system, user: userPrompt }
}
