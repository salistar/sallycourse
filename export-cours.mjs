// Export complet d'un cours SallyCourse vers un dossier local (Bureau).
// Aspire TOUS les objets S3/MinIO du cours (vidéos, sous-titres, slides,
// captures, ebook, podcast, flashcards, bande-annonce, cover) + dump le
// contenu texte (articles / TP / quiz) depuis MongoDB en JSON + Markdown.
//
// Usage : node export-cours.mjs <courseId> <destDir>
import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import { MongoClient, ObjectId } from 'mongodb';
import { mkdir, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

const COURSE_ID = process.argv[2];
const DEST = process.argv[3];
if (!COURSE_ID || !DEST) { console.error('usage: node export-cours.mjs <courseId> <destDir>'); process.exit(1); }

const S3_ENDPOINT = process.env.S3_ENDPOINT || 'http://localhost:9000';
const BUCKET = process.env.S3_BUCKET || 'sallycourse';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27027/sallycourse';

const s3 = new S3Client({
  endpoint: S3_ENDPOINT,
  region: process.env.S3_REGION || 'us-east-1',
  forcePathStyle: true, // MinIO
  credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY },
});

const prefix = `courses/${COURSE_ID}/`;
let token, total = 0, bytes = 0;

console.log(`Export du cours ${COURSE_ID}\n  depuis : ${S3_ENDPOINT}/${BUCKET}/${prefix}\n  vers   : ${DEST}\n`);

do {
  const list = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }));
  for (const obj of list.Contents ?? []) {
    const rel = obj.Key.slice(prefix.length);
    const dest = path.join(DEST, 'fichiers', rel);
    await mkdir(path.dirname(dest), { recursive: true });
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: obj.Key }));
    await pipeline(res.Body, createWriteStream(dest));
    total += 1; bytes += obj.Size ?? 0;
    console.log(`  ${String(total).padStart(3)} ${rel}  (${((obj.Size ?? 0) / 1024).toFixed(0)} Ko)`);
  }
  token = list.IsTruncated ? list.NextContinuationToken : undefined;
} while (token);

// ── Contenu texte depuis MongoDB ────────────────────────────────
const mongo = new MongoClient(MONGO_URI);
await mongo.connect();
const db = mongo.db();
const course = await db.collection('courses').findOne({ _id: new ObjectId(COURSE_ID) });
const sections = await db.collection('sections').find({ courseId: new ObjectId(COURSE_ID) }).sort({ order: 1 }).toArray();
const lessons = await db.collection('lessons').find({ courseId: new ObjectId(COURSE_ID) }).sort({ order: 1 }).toArray();

await writeFile(path.join(DEST, 'cours.json'), JSON.stringify({ course, sections, lessons }, null, 2), 'utf8');

// Markdown lisible
const md = [`# ${course.title}`, '', `> ${course.outline?.subtitle ?? ''}`, '', course.outline?.description ?? '', ''];
md.push('## Objectifs', ...(course.outline?.learningObjectives ?? []).map((o) => `- ${o}`), '');
md.push('## Prérequis', ...(course.outline?.prerequisites ?? []).map((o) => `- ${o}`), '');
for (const s of sections) {
  md.push(`\n## ${s.order + 1}. ${s.title}\n`);
  for (const l of lessons.filter((x) => String(x.sectionId) === String(s._id)).sort((a, b) => a.order - b.order)) {
    md.push(`### [${l.type}] ${l.title}  (~${l.durationMin} min)`, '', l.summary ?? '', '');
    const sc = l.script ?? {};
    if (Array.isArray(sc.slides)) for (const [i, sl] of sc.slides.entries()) {
      md.push(`**Slide ${i + 1} — ${sl.title ?? ''}**`, ...(sl.bullets ?? []).map((b) => `- ${b}`), '', `_Narration_ : ${sl.narration ?? ''}`, '');
    }
    if (sc.body) md.push(sc.body, '');
    if (sc.objective) md.push(`**Objectif** : ${sc.objective}`, '');
    if (Array.isArray(sc.environment)) md.push('**Environnement**', ...sc.environment.map((e) => `- ${e}`), '');
    if (Array.isArray(sc.steps)) for (const [i, st] of sc.steps.entries()) {
      md.push(`**Étape ${i + 1}** : ${st.instruction ?? ''}`, st.command ? '```bash\n' + st.command + '\n```' : '', st.expectedResult ? `_Attendu_ : ${st.expectedResult}` : '', '');
    }
    if (Array.isArray(sc.validation)) md.push('**Validation**', ...sc.validation.map((v) => `- ${v}`), '');
    if (Array.isArray(sc.questions)) for (const [i, q] of sc.questions.entries()) {
      md.push(`**Q${i + 1}. ${q.question}**`, ...(q.choices ?? []).map((c, j) => `  ${j === q.correctIndex ? '✅' : '　'} ${c}`), q.explanation ? `_${q.explanation}_` : '', '');
    }
  }
}
await writeFile(path.join(DEST, 'cours.md'), md.join('\n'), 'utf8');
await mongo.close();

console.log(`\n✅ Terminé : ${total} fichiers (${(bytes / 1024 / 1024).toFixed(1)} Mo) + cours.json + cours.md`);
console.log(`   → ${DEST}`);
