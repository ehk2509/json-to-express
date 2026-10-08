import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import {config} from './config';
import './styles.css';

document.title = config.title;
document.documentElement.dataset.theme = config.theme.mode;
document.documentElement.style.setProperty('--brand', config.theme.brandColor);

createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>
);
