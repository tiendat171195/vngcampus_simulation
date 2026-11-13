import { accessToken } from '../../services/auth';
import { NetClient } from './NetClient';

/** The one connection of this page. */
export const net = new NetClient(accessToken);
