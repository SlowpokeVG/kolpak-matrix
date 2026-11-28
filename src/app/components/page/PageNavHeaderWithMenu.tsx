import type { ReactNode } from 'react';
import type { RectCords } from 'folds';
import { Box, IconButton, Text } from 'folds';
import { composerIcon, DotsThreeOutlineVerticalIcon } from '$components/icons/phosphor';
import { PageNavHeader } from '$components/page';
import { ResponsiveMenu } from '$components/ResponsiveMenu';
import { JumpTo } from '../../../kolpak/layout/JumpTo';
import { ShlomoMenuDot, useShlomoMenuBadge } from '../../../kolpak/simple/ShlomoMenuRows';

type PageNavHeaderWithMenuProps = {
  hideText?: boolean;
  title: ReactNode;
  collapsedIcon: ReactNode;
  menu: ReactNode;
  anchor: RectCords | undefined;
  requestClose: () => void;
  triggerProps: {
    onClick: React.MouseEventHandler<HTMLButtonElement>;
  };
};

export function PageNavHeaderWithMenu({
  hideText,
  title,
  collapsedIcon,
  menu,
  anchor,
  requestClose,
  triggerProps,
}: PageNavHeaderWithMenuProps) {
  // Kolpak: a dot while the inbox has something and the menu holds it (Shlomo mode).
  const inbox = useShlomoMenuBadge();
  return (
    <>
      <PageNavHeader size="600">
        {hideText ? (
          <Box alignItems="Center" grow="Yes" justifyContent="Center">
            <IconButton aria-pressed={!!anchor} variant="Background" onClick={triggerProps.onClick}>
              {collapsedIcon}
            </IconButton>
          </Box>
        ) : (
          <Box grow="Yes" gap="300">
            <Box grow="Yes" alignItems="Center">
              <Text size="H4" truncate>
                {title}
              </Text>
            </Box>
            <Box shrink="No">
              <IconButton
                aria-pressed={!!anchor}
                variant="Background"
                onClick={triggerProps.onClick}
                style={{ position: 'relative' }}
              >
                {composerIcon(DotsThreeOutlineVerticalIcon, {
                  weight: anchor ? 'fill' : 'regular',
                })}
                <ShlomoMenuDot count={inbox} />
              </IconButton>
            </Box>
          </Box>
        )}
      </PageNavHeader>
      {/* Kolpak: the "jump to" box sits under the header of every room list. */}
      {!hideText && (
        <div className="kolpak-jump-to-row">
          <JumpTo />
        </div>
      )}
      <ResponsiveMenu
        anchor={anchor}
        requestClose={requestClose}
        position="Bottom"
        align="End"
        offset={6}
        menu={menu}
      />
    </>
  );
}
