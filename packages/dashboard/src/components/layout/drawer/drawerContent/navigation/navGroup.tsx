// material-ui
import { Box, List, Typography } from "@mui/material";

import { useAppStore } from "../../../../../lib/appStore";
import { MenuItemGroup } from "../../../../menuItems/types";
// project import
import NavItem from "./navItem";

// ==============================|| NAVIGATION - LIST GROUP ||============================== //

function NavGroup({ item }: { item: MenuItemGroup }) {
  const drawerOpen = useAppStore((state) => state.drawerOpen);

  const navCollapse = item.children.map((menuItem) => (
    <NavItem key={menuItem.id} item={menuItem} level={1} />
  ));

  return (
    <List
      subheader={
        item.title &&
        drawerOpen && (
          <Box sx={{ pb: 0.75, pl: 3, pt: 2.25 }}>
            <Typography variant="overline">
              {item.title}
            </Typography>
          </Box>
        )
      }
      sx={{ mb: drawerOpen ? 0.5 : 0, py: 0, zIndex: 0 }}
    >
      {navCollapse}
    </List>
  );
}

export default NavGroup;
