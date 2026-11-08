import './styles/tokens.css';
import './styles/base.css';
import './styles/ui.css';
import { initI18n } from './i18n';
import { initMotion } from './motion';
import { startRouter } from './router';

initI18n();
initMotion();
const root = document.getElementById('root');
if (root) startRouter(root);
