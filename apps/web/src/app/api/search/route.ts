import { NextResponse } from 'next/server';
import {
  connectDb,
  Course as CourseModel,
  Section as SectionModel,
  Lesson as LessonModel,
} from '@sallycourse/db';
import { requireApiUser } from '@/lib/session';
import {
  buildTextSearchQuery,
  excerptAroundMatch,
  groupResultsByCourse,
  validateSearchQuery,
  type SearchResultGroup,
} from '@/lib/search';

/**
 * GET /api/search?q=... — recherche globale (P132), cross-collection
 * (Course/Section/Lesson) limitée aux cours de l'utilisateur connecté.
 * Full-text simple via l'index texte MongoDB natif ($text) — pas
 * d'Elasticsearch/Meilisearch avant Phase 9 OSS. Résultats groupés par cours,
 * triés par score de pertinence $text décroissant au sein d'un groupe.
 */
export async function GET(request: Request) {
  const user = await requireApiUser();
  if (user instanceof Response) return user;

  const { searchParams } = new URL(request.url);
  const validation = validateSearchQuery(searchParams.get('q'));
  if (!validation.valid) {
    return NextResponse.json({ query: validation.query, groups: [] satisfies SearchResultGroup[] });
  }
  const { query } = validation;

  await connectDb();

  // Cours de l'utilisateur — sert de scope pour Section/Lesson (pas de userId
  // direct sur ces collections). Chargé une seule fois, réutilisé partout.
  const userCourses = await CourseModel.find({ userId: user.id }, { title: 1 }).lean();
  const userCourseIds = userCourses.map((c) => c._id);
  const courseTitleById = new Map(userCourses.map((c) => [String(c._id), c.title]));

  if (userCourseIds.length === 0) {
    return NextResponse.json({ query, groups: [] satisfies SearchResultGroup[] });
  }

  const courseQuery = buildTextSearchQuery(query, { userId: user.id, _id: { $in: userCourseIds } });
  const sectionQuery = buildTextSearchQuery(query, { courseId: { $in: userCourseIds } });
  const lessonQuery = buildTextSearchQuery(query, { courseId: { $in: userCourseIds } });

  const [courseHits, sectionHits, lessonHits] = await Promise.all([
    CourseModel.find(courseQuery.filter, courseQuery.projection)
      .sort(courseQuery.sort)
      .limit(courseQuery.limit)
      .lean(),
    SectionModel.find(sectionQuery.filter, sectionQuery.projection)
      .sort(sectionQuery.sort)
      .limit(sectionQuery.limit)
      .lean(),
    LessonModel.find(lessonQuery.filter, lessonQuery.projection)
      .sort(lessonQuery.sort)
      .limit(lessonQuery.limit)
      .lean(),
  ]);

  const flatItems: Array<{
    kind: 'course' | 'section' | 'lesson';
    id: string;
    title: string;
    excerpt?: string;
    score: number;
    href: string;
    courseId: string;
    courseTitle: string;
  }> = [];

  for (const course of courseHits) {
    flatItems.push({
      kind: 'course',
      id: String(course._id),
      title: course.title,
      score: (course as unknown as { score?: number }).score ?? 0,
      href: `/dashboard/courses/${course._id}`,
      courseId: String(course._id),
      courseTitle: course.title,
    });
  }

  for (const section of sectionHits) {
    const courseId = String(section.courseId);
    const courseTitle = courseTitleById.get(courseId);
    if (!courseTitle) continue; // sécurité : section hors scope utilisateur
    flatItems.push({
      kind: 'section',
      id: String(section._id),
      title: section.title,
      score: (section as unknown as { score?: number }).score ?? 0,
      href: `/dashboard/courses/${courseId}`,
      courseId,
      courseTitle,
    });
  }

  for (const lesson of lessonHits) {
    const courseId = String(lesson.courseId);
    const courseTitle = courseTitleById.get(courseId);
    if (!courseTitle) continue; // sécurité : leçon hors scope utilisateur
    flatItems.push({
      kind: 'lesson',
      id: String(lesson._id),
      title: lesson.title,
      excerpt: lesson.summary ? excerptAroundMatch(lesson.summary, query) : undefined,
      score: (lesson as unknown as { score?: number }).score ?? 0,
      href: `/dashboard/courses/${courseId}`,
      courseId,
      courseTitle,
    });
  }

  const groups = groupResultsByCourse(flatItems).sort((a, b) => {
    const maxA = Math.max(...a.items.map((i) => i.score));
    const maxB = Math.max(...b.items.map((i) => i.score));
    return maxB - maxA;
  });

  return NextResponse.json({ query, groups });
}
