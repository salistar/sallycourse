import { CourseGrid, GenerationPanel, GreetingHeader, MOCK_COURSES, MOCK_STATS, MOCK_USER } from '@/components/dashboard';

/**
 * Dashboard « mission control » — assemblage serveur des volets :
 * salutation + compteurs animés, génération en direct (timeline + terminal +
 * aperçu de slide) et grille de cours. Données MOCK typées ; le câblage réel
 * (API / temps réel) arrive au Prompt 9 sans changer cette composition.
 */
export default function DashboardPage() {
  // Cours actuellement en génération (mock) — alimente le panneau live.
  const generating = MOCK_COURSES.find((course) => course.status === 'generating');
  const firstName = MOCK_USER.name.split(/\s+/)[0] ?? MOCK_USER.name;

  return (
    <div className="flex flex-col gap-10">
      <GreetingHeader firstName={firstName} stats={MOCK_STATS} />

      {generating && <GenerationPanel courseTitle={generating.title} />}

      <CourseGrid courses={MOCK_COURSES} />
    </div>
  );
}
