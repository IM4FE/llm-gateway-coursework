import { createTheme } from '@mui/material/styles'

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#4f7cff',
      light: '#8fb0ff',
      dark: '#3d68e8',
    },
    error: {
      main: '#f87171',
    },
    background: {
      default: '#070b16',
      paper: '#101a31',
    },
    text: {
      primary: '#e5ecff',
      secondary: '#94a3b8',
    },
    divider: 'rgba(148, 163, 184, 0.18)',
  },
  shape: {
    borderRadius: 12,
  },
  typography: {
    fontFamily: "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif",
    h4: {
      fontWeight: 700,
      letterSpacing: '-0.02em',
    },
    h6: {
      fontWeight: 650,
    },
    subtitle1: {
      fontWeight: 650,
    },
    button: {
      fontWeight: 600,
      textTransform: 'none',
    },
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
      },
    },
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundImage:
            'radial-gradient(circle at 15% -10%, rgba(79, 124, 255, 0.18), transparent 34%), radial-gradient(circle at 90% 0%, rgba(52, 211, 153, 0.08), transparent 28%)',
          backgroundAttachment: 'fixed',
        },
      },
    },
  },
})
