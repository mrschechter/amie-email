import { ReactNode, useEffect, useRef, useState } from "react";

// Mount table hooks only when the table approaches the viewport.
export default function DeferredTable({ children }: { children: ReactNode }) {
  const target = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    if (target.current) observer.observe(target.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={target}>
      {visible ? (
        children
      ) : (
        <button type="button" onClick={() => setVisible(true)}>
          Load recent deliveries
        </button>
      )}
    </div>
  );
}
