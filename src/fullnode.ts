/**
 * Copyright (c) Hathor Labs and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import axios from 'axios';

export const BASE_URL = process.env.DEFAULT_SERVER;
export const TIMEOUT = 10000;

/**
 * Creates a handler for requesting data from the fullnode
 *
 * @param baseURL - The base URL for the full-node. Defaults to `env.DEFAULT_SERVER`
 */
export const create = (baseURL = BASE_URL): any => {
  const api = axios.create({
    baseURL,
    headers: {},
    timeout: TIMEOUT,
  });

  const downloadTx = async (txId: string) => {
    const response = await api.get(`transaction?id=${txId}`, {
      data: null,
      headers: { 'content-type': 'application/json' },
    });

    return response.data;
  };

  const getConfirmationData = async (txId: string) => {
    const response = await api.get(`transaction_acc_weight?id=${txId}`, {
      data: null,
      headers: { 'content-type': 'application/json' },
    });

    return response.data;
  };

  const queryGraphvizNeighbours = async (
    txId: string,
    graphType: string,
    maxLevel: number,
  ) => {
    const url = `graphviz/neighbours.dot/?tx=${txId}&graph_type=${graphType}&max_level=${maxLevel}`;
    const response = await api.get(url, {
      data: null,
      headers: { 'content-type': 'application/json' },
    });

    return response.data;
  };

  return {
    api, // exported so we can mock it on the tests
    downloadTx,
    getConfirmationData,
    queryGraphvizNeighbours,
  };
};

export default create();
