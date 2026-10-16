import { useState } from "react";
import Button from "@/components/Button";

export default function CommentCell({
  value,
  onCommit,
  placeholder = "点击写评语",
  disabled = false,
}: {
  value?: string;
  onCommit: (comment: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  function openEditor() {
    setDraft(value ?? "");
    setOpen(true);
  }

  function save() {
    onCommit(draft.trim());
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={openEditor}
        title={value || placeholder}
        className={`block w-full max-w-[220px] truncate rounded-md px-1.5 py-1 text-left text-xs transition ${
          disabled
            ? "cursor-not-allowed text-slate-300"
            : value
              ? "text-slate-600 hover:bg-slate-100"
              : "text-slate-300 hover:bg-slate-100 hover:text-slate-500"
        }`}
      >
        {value || placeholder}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold text-slate-800">人工评价</h3>
            <p className="mt-1 text-xs text-slate-500">
              自定义评语，将随评分历史一并保存
            </p>
            <textarea
              autoFocus
              rows={5}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
              }}
              placeholder="请输入评语…"
              className="mt-3 w-full resize-y rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-800 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button type="button" onClick={save}>
                保存
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
