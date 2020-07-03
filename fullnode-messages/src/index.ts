/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import FullNodeConnection from './connection';

const connection: FullNodeConnection = new FullNodeConnection();
connection.start();