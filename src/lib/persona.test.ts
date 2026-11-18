import { describe, expect, it } from 'vitest'
import { DUCK_NAME, PERSONA_TEMPLATES, seedPersonas, type Persona, type PersonaStore } from './persona'

describe('nhân vật có sẵn', () => {
  it('cài mọi nhân vật mẫu, Golden Duck đầu tiên, gọi trùng vẫn chỉ cài một lần', async () => {
    const items: Persona[] = []
    const save = async (p: Omit<Persona, 'id'>): Promise<PersonaStore> => { items.push({ ...p, id: `p${items.length}` }); return { items: [...items], chats: {} } }
    const [a, b] = await Promise.all([seedPersonas(save), seedPersonas(save)])
    expect(a).toBe(b)
    expect(items.length).toBe(new Set(PERSONA_TEMPLATES.map((t) => t.p.name)).size)
    expect(items[0].name).toBe(DUCK_NAME)
    expect(new Set(items.map((p) => p.name)).size).toBe(items.length)
  })
})
