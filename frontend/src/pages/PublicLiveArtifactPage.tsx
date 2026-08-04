import { useParams } from "react-router-dom";
import LiveArtifactViewer from "@/components/LiveArtifactViewer";

export default function PublicLiveArtifactPage() {
  const { slug } = useParams<{ slug: string }>();
  return (
    <div className="fixed inset-0 flex flex-col bg-background">
      <LiveArtifactViewer slug={slug} publicMode />
    </div>
  );
}
