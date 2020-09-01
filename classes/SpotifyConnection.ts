import axios, { AxiosRequestConfig } from 'axios';
import Paged, { Playlist, SpotifyPage } from 'classes/Paged';
import querystring from 'querystring';

const apiHost = 'https://api.spotify.com';
const apiVersion = 'v1';
const apiRoot = `${apiHost}/${apiVersion}`;

export type FetchConfig = Omit<AxiosRequestConfig, 'url'>;
export type MethodConfig = Omit<FetchConfig, 'method'>;

export interface FetchResult<T = unknown> {
    data: T;
    status: number;
}

export interface Images {
    width: number;
    height: number;
    url: string;
}

export interface UserProfile {
    display_name: string;
    external_urls: { spotify: string };
    followers: { href: null; total: number };
    href: string;
    id: string;
    images: Images[];
    type: 'user';
    uri: string;
}

interface EstablishOptions {
    accessToken: string;
    refreshToken: string;

    /**
     * An optional callback to be run if the user profile is successfully
     * gotten.
     */
    onGettingUserProfile?: (profile: UserProfile) => void;

    /**
     * An optional callback to be run if the access token changed.
     */
    onAccessTokenChange?: (newToken: string) => void;
}

/**
 * Represents an authorized connection to a user's Spotify account, with the
 * ability to refresh its access token if it has expired. It can use Spotify's
 * RESTful API to fetch information about the user and music on Spotify's
 * database.
 */
export default class SpotifyConnection {
    /**
     * Instantiates SpotifyConnection. There is no immediate
     * @param _accessToken
     * @param refreshToken
     */
    private constructor(private _accessToken: string, public readonly refreshToken: string) {}

    /**
     * Instantiates SpotifyConnection with the given tokens and verifies
     * whether the tokens work.
     *
     * @param options An object containing the inputs to try establishing the
     * connection with.
     * @returns A Promise of the SpotifyConnection. Rejects if there was an
     * error establishing the connection, e.g. HTTP 401 for invalid tokens.
     */
    static async establish(options: EstablishOptions): Promise<SpotifyConnection> {
        const {
            accessToken,
            refreshToken,
            onGettingUserProfile = () => undefined,
            onAccessTokenChange = () => undefined,
        } = options;

        const connection = new SpotifyConnection(accessToken, refreshToken);
        onGettingUserProfile(await connection.verify(onAccessTokenChange));
        return connection;
    }

    public get accessToken(): string {
        return this._accessToken;
    }

    protected async fetch<T>(endpoint: string, config: FetchConfig = {}): Promise<FetchResult<T>> {
        const headers = { ...config.headers, Authorization: `Bearer ${this.accessToken}` };
        const { data, status } = await axios(apiRoot + endpoint, { ...config, headers });
        return { data, status };
    }

    protected async get<T>(endpoint: string, config: MethodConfig = {}): Promise<FetchResult<T>> {
        return this.fetch(endpoint, { ...config, method: 'get' });
    }

    /**
     * Gets the user's profile from Spotify's database.
     *
     * @returns A Promise of the user's profile. Rejects on HTTP failure
     * statuses.
     */
    public async fetchUserProfile(): Promise<UserProfile> {
        const { data, status } = await this.get<UserProfile>('/me');
        if (status !== 200) throw status;
        return data;
    }

    /**
     * Verifies that the tokens supplied allows you to access a Spotify user's
     * profile. If the access token is invalid/expired, it will try to obtain a
     * new one using the refresh token.
     *
     * @returns A Promise of the user's profile. Rejects if the tokens given
     * are invalid, with the corresponding HTTP status.
     */
    public async verify(onAccessTokenChange: (newToken: string) => void): Promise<UserProfile> {
        try {
            return await this.fetchUserProfile();
        } catch (error) {
            // Authorization failed, try getting a refresh token
            if (error.isAxiosError && error.response.status === 401) {
                const response = await axios({
                    url:
                        '/api/refresh?' +
                        querystring.stringify({
                            refresh_token: this.refreshToken,
                        }),
                    method: 'GET',
                });

                // Successfully got refresh token
                if (response.status === 200) {
                    this._accessToken = response.data.access_token;
                    onAccessTokenChange(this.accessToken);
                    return await this.fetchUserProfile();
                }

                throw response.status;
            }

            throw error;
        }
    }

    /**
     * Gets the user's playlists from Spotify's database.
     *
     * @returns A Paged container of the user's playlists.
     */
    public async fetchUserPlaylists(perPage = 50): Promise<Paged<Playlist>> {
        const fetcher = async (limit: number, offset: number) =>
            (
                await this.get<SpotifyPage<Playlist>>('/me/playlists', {
                    params: { limit, offset },
                })
            ).data;

        return Paged.create(perPage, fetcher);
    }
}