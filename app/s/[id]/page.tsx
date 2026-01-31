"use client";

import { useParams } from "next/navigation";
import { SharePageClient } from "../../components/share-view";
import { isValidShareId } from "../../utils/share";
import containerStyles from "../../styles/container.module.scss";

export default function SharePage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  if (!id || typeof id !== "string") {
    return (
      <div
        className={`${containerStyles.container} ${containerStyles["tight-container"]} ${containerStyles["window-content"]}`}
        style={{ padding: "2rem", textAlign: "center" }}
      >
        无效的分享链接
      </div>
    );
  }
  if (!isValidShareId(id)) {
    return (
      <div
        className={`${containerStyles.container} ${containerStyles["tight-container"]} ${containerStyles["window-content"]}`}
        style={{ padding: "2rem", textAlign: "center" }}
      >
        无效的分享链接
      </div>
    );
  }

  return (
    <div
      className={`${containerStyles.container} ${containerStyles["tight-container"]} ${containerStyles["window-content"]}`}
      id="app-body"
    >
      <SharePageClient shareId={id} />
    </div>
  );
}
