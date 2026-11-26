import { useState } from 'react';
import { Box, Button, Text, config } from 'folds';
import { PromptDialog } from '$components/modal-overlay/PromptDialog';
import { ImportKeys } from '$features/settings/devices/LocalBackup';

// Kolpak: a room-key export shared to Kolpak (from Element: Settings → Security & Privacy →
// Export E2E room keys, then Share → Kolpak). Instead of offering to post the file in a
// room, ask for the export's passphrase and load the keys, so old encrypted messages
// become readable here. The decryption and the import are Sable's (Settings → Devices →
// Import Messages Data); this only saves the trip there.

type KeyImportPromptProps = {
  file: File;
  /** Close after the keys are in, or when the user gives up. */
  onClose: () => void;
  /** The user wants the file posted to a room after all. */
  onShareInstead: () => void;
};

export function KeyImportPrompt({ file, onClose, onShareInstead }: KeyImportPromptProps) {
  const [done, setDone] = useState(false);

  return (
    <PromptDialog title="Import message keys" requestClose={onClose}>
      <Box
        direction="Column"
        gap="400"
        style={{ padding: config.space.S400, paddingTop: config.space.S300 }}
      >
        {done ? (
          <>
            <Text size="T300">
              Keys imported. Messages they cover can now be read here; rooms may take a moment to
              catch up.
            </Text>
            <Button variant="Primary" onClick={onClose}>
              <Text size="B400">Done</Text>
            </Button>
          </>
        ) : (
          <>
            <Text size="T300" priority="400">
              <b>{file.name}</b> is an encrypted copy of message keys, like the one Element exports.
              Enter the passphrase you chose when exporting it.
            </Text>
            <ImportKeys file={file} onDone={() => setDone(true)} />
            <Button variant="Secondary" fill="None" onClick={onShareInstead}>
              <Text size="B300">Send the file to a room instead</Text>
            </Button>
          </>
        )}
      </Box>
    </PromptDialog>
  );
}
