// Project repository: everything the screens need from the database.
import { db, deleteProject, type AssetRow, type Id, type ProjectRow, type TimelineDoc } from "./db";
import { removeFile } from "./opfs";
import { durationOf, emptyDoc, mainClips } from "../editor/timeline";

export async function listProjects(): Promise<ProjectRow[]> {
  return db.projects.orderBy("updatedAt").reverse().toArray();
}

export async function createProject(): Promise<ProjectRow> {
  const now = Date.now();
  const name = `Projeto ${new Date(now).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${new Date(now).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  const row: ProjectRow = {
    id: crypto.randomUUID(),
    name,
    aspectRatio: "original",
    fps: 30,
    durationUs: 0,
    thumbAssetKey: null,
    docVersion: 0,
    createdAt: now,
    updatedAt: now,
  };
  await db.transaction("rw", db.projects, db.projectDocs, async () => {
    await db.projects.add(row);
    await db.projectDocs.add({ projectId: row.id, doc: emptyDoc(row.aspectRatio), savedAt: now });
  });
  return row;
}

export async function loadProject(id: Id) {
  const [project, docRow, assets] = await Promise.all([
    db.projects.get(id),
    db.projectDocs.get(id),
    db.assets.where("projectId").equals(id).toArray(),
  ]);
  if (!project || !docRow) return null;
  return { project, doc: docRow.doc, assets };
}

export async function saveDoc(projectId: Id, doc: TimelineDoc) {
  const now = Date.now();
  const first = mainClips(doc)[0];
  await db.transaction("rw", db.projects, db.projectDocs, async () => {
    await db.projectDocs.put({ projectId, doc, savedAt: now });
    await db.projects
      .where("id")
      .equals(projectId)
      .modify((p) => {
        p.durationUs = durationOf(doc);
        p.aspectRatio = doc.canvas.aspectRatio;
        p.thumbAssetKey = first?.assetId ?? null;
        p.docVersion += 1;
        p.updatedAt = now;
      });
  });
}

export async function renameProject(id: Id, name: string) {
  await db.projects.update(id, { name: name.trim().slice(0, 120) || "Sem nome", updatedAt: Date.now() });
}

// Copies the records; the media files are shared, not copied. A template
// is a copy kept as a starting point; using one makes a normal project.
export async function duplicateProject(id: Id, as: { template?: boolean; name?: string } = {}): Promise<Id | null> {
  const src = await loadProject(id);
  if (!src) return null;
  const now = Date.now();
  const newId = crypto.randomUUID();
  const idMap = new Map<Id, Id>();
  const assets: AssetRow[] = src.assets.map((a) => {
    const nid = crypto.randomUUID();
    idMap.set(a.id, nid);
    return { ...a, id: nid, projectId: newId, createdAt: now, updatedAt: now };
  });
  let json = JSON.stringify(src.doc);
  for (const [from, to] of idMap) json = json.split(from).join(to);
  const derivs = await db.derivatives.where("assetId").anyOf([...idMap.keys()]).toArray();
  await db.transaction("rw", [db.projects, db.projectDocs, db.assets, db.derivatives], async () => {
    await db.projects.add({
      ...src.project,
      id: newId,
      name: (as.name ?? `${src.project.name} (cópia)`).slice(0, 120),
      template: as.template || undefined,
      thumbAssetKey: src.project.thumbAssetKey ? (idMap.get(src.project.thumbAssetKey) ?? null) : null,
      createdAt: now,
      updatedAt: now,
    });
    await db.projectDocs.add({ projectId: newId, doc: JSON.parse(json), savedAt: now });
    await db.assets.bulkAdd(assets);
    await db.derivatives.bulkAdd(
      derivs.map((d) => ({ ...d, id: crypto.randomUUID(), assetId: idMap.get(d.assetId)!, createdAt: now })),
    );
  });
  return newId;
}

export async function removeProject(id: Id) {
  const paths = await deleteProject(id);
  await Promise.all(paths.map(removeFile));
}

export async function thumbsFor(assetIds: Id[]) {
  const rows = await db.derivatives.where("assetId").anyOf(assetIds).toArray();
  return rows.filter((r) => r.kind === "thumbs");
}
