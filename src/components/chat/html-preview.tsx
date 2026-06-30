import { motion, AnimatePresence } from "framer-motion";
import { X, Download, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadText } from "@/lib/download";

export function HtmlPreview({
  html,
  onClose,
}: {
  html: string | null;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {html && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.2 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-5xl h-[85vh] rounded-2xl border border-white/10 bg-background/95 backdrop-blur-xl shadow-2xl flex flex-col overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <div className="text-sm font-medium tracking-tight">Preview HTML</div>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const w = window.open();
                    if (w) {
                      w.document.open();
                      w.document.write(html);
                      w.document.close();
                    }
                  }}
                  className="gap-1.5 h-8 text-xs"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Nova aba
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => downloadText(html, "index.html", "text/html")}
                  className="gap-1.5 h-8 text-xs"
                >
                  <Download className="h-3.5 w-3.5" /> .html
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={onClose}
                  className="h-8 w-8"
                  aria-label="Fechar"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <iframe
              title="HTML preview"
              sandbox="allow-scripts allow-forms"
              srcDoc={html}
              className="flex-1 w-full bg-white"
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
