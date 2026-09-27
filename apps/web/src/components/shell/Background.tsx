import DotGrid from "@/components/reactbits/DotGrid";

/** The app-wide interactive backdrop: solid dots that light up marigold near the pointer. */
export function Background() {
  return <DotGrid className="fixed inset-0 z-0" dotSize={2} gap={26} baseColor="#232328" activeColor="#f0b23e" proximity={140} />;
}
