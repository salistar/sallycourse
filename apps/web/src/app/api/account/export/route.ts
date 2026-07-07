import {
  ApiKey,
  Course as CourseModel,
  CourseAnalytics,
  Deployment,
  Enrollment,
  GenerationJob,
  Lesson,
  LmsListing,
  Notification,
  PlatformCredential,
  Quiz,
  Section,
  Subscription,
  User as UserModel,
  Webhook,
  connectDb,
} from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import { buildZip, type ZipEntry } from '@/lib/simple-zip';

// Données personnelles : jamais de cache, runtime Node (accès Mongo + zip).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/account/export — export RGPD (portabilité) des données de
 * l'utilisateur connecté (P66). Renvoie un ZIP contenant un fichier JSON par
 * collection, LEAN et SANS SECRETS (mots de passe, clés API hashées, blobs de
 * credentials chiffrés, secrets de webhook exclus des exports — seules les
 * métadonnées utiles à l'utilisateur sont incluses).
 */
export async function GET() {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  await connectDb();
  const userId = user.id;

  const [
    profile,
    courses,
    sections,
    lessons,
    quizzes,
    generationJobs,
    deployments,
    platformCredentials,
    lmsListings,
    enrollments,
    apiKeys,
    webhooks,
    subscriptions,
    courseAnalytics,
    notifications,
  ] = await Promise.all([
    UserModel.findById(userId).select('-passwordHash').lean(),
    CourseModel.find({ userId }).lean(),
    CourseModel.find({ userId })
      .select('_id')
      .lean()
      .then((cs) => Section.find({ courseId: { $in: cs.map((c) => c._id) } }).lean()),
    CourseModel.find({ userId })
      .select('_id')
      .lean()
      .then((cs) => Lesson.find({ courseId: { $in: cs.map((c) => c._id) } }).lean()),
    CourseModel.find({ userId })
      .select('_id')
      .lean()
      .then((cs) => Quiz.find({ courseId: { $in: cs.map((c) => c._id) } }).lean()),
    CourseModel.find({ userId })
      .select('_id')
      .lean()
      .then((cs) => GenerationJob.find({ courseId: { $in: cs.map((c) => c._id) } }).lean()),
    Deployment.find({ userId }).lean(),
    // Credentials : jamais le blob chiffré `data`, seulement les métadonnées.
    PlatformCredential.find({ userId }).select('-data').lean(),
    LmsListing.find({ userId }).lean(),
    Enrollment.find({ studentId: userId }).lean(),
    // Clés API : jamais hashedKey (secret), seulement préfixe + libellé.
    ApiKey.find({ userId }).select('-hashedKey').lean(),
    // Webhooks : jamais le secret de signature HMAC.
    Webhook.find({ userId }).select('-secret').lean(),
    Subscription.find({ userId }).lean(),
    CourseAnalytics.find({ userId }).lean(),
    Notification.find({ userId }).lean(),
  ]);

  if (!profile) {
    return Response.json({ error: 'Utilisateur introuvable.' }, { status: 404 });
  }

  const entries: ZipEntry[] = [
    { name: 'profil.json', data: JSON.stringify(profile, null, 2) },
    { name: 'cours.json', data: JSON.stringify(courses, null, 2) },
    { name: 'sections.json', data: JSON.stringify(sections, null, 2) },
    { name: 'lecons.json', data: JSON.stringify(lessons, null, 2) },
    { name: 'quiz.json', data: JSON.stringify(quizzes, null, 2) },
    { name: 'jobs-generation.json', data: JSON.stringify(generationJobs, null, 2) },
    { name: 'deploiements.json', data: JSON.stringify(deployments, null, 2) },
    { name: 'plateformes-connectees.json', data: JSON.stringify(platformCredentials, null, 2) },
    { name: 'catalogue-lms.json', data: JSON.stringify(lmsListings, null, 2) },
    { name: 'inscriptions-lms.json', data: JSON.stringify(enrollments, null, 2) },
    { name: 'cles-api.json', data: JSON.stringify(apiKeys, null, 2) },
    { name: 'webhooks.json', data: JSON.stringify(webhooks, null, 2) },
    { name: 'abonnement.json', data: JSON.stringify(subscriptions, null, 2) },
    { name: 'statistiques-cours.json', data: JSON.stringify(courseAnalytics, null, 2) },
    { name: 'notifications.json', data: JSON.stringify(notifications, null, 2) },
    {
      name: 'README.txt',
      data:
        'Export des données SallyCourse — RGPD (droit à la portabilité).\n' +
        `Généré le ${new Date().toISOString()}.\n\n` +
        'Les secrets (mot de passe, clés API, identifiants de plateformes chiffrés,\n' +
        'secrets de webhook) sont volontairement exclus de cet export.\n',
    },
  ];

  const zip = buildZip(entries);
  const filename = `sallycourse-export-${userId}-${Date.now()}.zip`;

  return new Response(new Uint8Array(zip), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(zip.length),
    },
  });
}
