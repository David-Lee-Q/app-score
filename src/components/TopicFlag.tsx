import type { DirectedTopicCheck } from "@/types";

export default function TopicFlag({
  check,
  className = "",
}: {
  check?: DirectedTopicCheck;
  className?: string;
}) {
  if (!check || check.conforms) return null;
  const reason = check.reason || "材料与定向赛题要求不符，建议人工复核。";
  return (
    <span
      className={`ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-500 align-middle text-[11px] font-bold leading-none text-white ${className}`}
      title={`定向赛题校验未通过：${reason}`}
      role="img"
      aria-label={`定向赛题校验未通过：${reason}`}
    >
      !
    </span>
  );
}
