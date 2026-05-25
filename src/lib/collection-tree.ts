import { prisma } from '@/lib/db'

/**
 * "Klasik Eserler" tıklandığında altındaki Kelâm/Tefsir/... hep dahil olsun:
 * verilen klasör + tüm alt-klasör ID'lerini döner.
 */
export async function getDescendantCollectionIds(
  userId: string,
  rootId: string,
): Promise<string[]> {
  const all = await prisma.libraryCollection.findMany({
    where: { userId },
    select: { id: true, parentId: true },
  })
  const childrenByParent = new Map<string, string[]>()
  for (const c of all) {
    if (!c.parentId) continue
    const arr = childrenByParent.get(c.parentId) ?? []
    arr.push(c.id)
    childrenByParent.set(c.parentId, arr)
  }
  const result: string[] = [rootId]
  const stack: string[] = [rootId]
  while (stack.length) {
    const id = stack.pop()!
    for (const child of childrenByParent.get(id) ?? []) {
      result.push(child)
      stack.push(child)
    }
  }
  return result
}
