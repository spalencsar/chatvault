import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/** Gives an account a name of your own. The original (email or id) is kept, and clearing the name brings it back. */
export function RenameAccountDialog({
  account,
  onSave,
  onClose,
}: {
  /** The account being renamed; null keeps the dialog closed. */
  account: { id: string; original: string; custom: string } | null;
  onSave: (id: string, name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  useEffect(() => {
    if (account) setName(account.custom);
  }, [account]);

  const save = () => {
    if (!account) return;
    onSave(account.id, name);
    onClose();
  };

  return (
    <Dialog open={!!account} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Users className="size-4 text-muted-foreground" strokeWidth={1.5} />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-base font-medium">Rename account</DialogTitle>
              <DialogDescription className="truncate">Only changes how it is shown in ChatVault.</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Input autoFocus value={name} maxLength={60} placeholder={account?.original} onChange={(e) => setName(e.target.value)} aria-label="Account name" />
          <p className="break-all text-xs text-muted-foreground">Original: {account?.original}</p>
          <DialogFooter className="gap-2 sm:gap-2">
            {account?.custom && (
              <Button type="button" variant="ghost" className="sm:mr-auto" onClick={() => { onSave(account.id, ""); onClose(); }}>
                Use the original
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
