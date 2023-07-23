export default function Footer() {
    return (
        <footer
        className="footer"
            style={{
                display: 'flex',
                justifyContent: 'space-between',
                height: '300px',
                width: '100vw',
                color: 'white',
                background: 'rgb(17, 17, 17)',
                padding: '20px',
            }}
        >

            <ColoredLine color="rgba(256,256,256,0.5)" />


            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', marginTop: '20px', marginLeft: '25px' }}>
                <p>Building a Decentralized Network <br />
                    of Decentralized Networks</p>

                <p style={{ marginTop: '10px', display: 'flex', alignItems: 'center', marginBottom: '20px' }}>
                    <svg data-bbox="29.5 43 141 114" fill="white" viewBox="0 0 200 200" height="2em" width="2em" xmlns="http://www.w3.org/2000/svg" data-type="shape">
                        <g>
                            <path d="M170.494 60.131C170.429 50.674 162.699 43 153.2 43H46.8c-9.499 0-17.229 7.674-17.294 17.131-.001.028-.004.055-.004.082l-.002.037v79.5c0 9.512 7.761 17.25 17.3 17.25h106.4c9.539 0 17.3-7.738 17.3-17.25v-79.5l-.002-.037c0-.027-.003-.055-.004-.082zM46.8 51h106.4c4.458 0 8.191 3.138 9.09 7.309L100 101.749l-62.29-43.44C38.609 54.138 42.341 51 46.8 51zm106.4 98H46.8c-5.128 0-9.3-4.149-9.3-9.25V67.916l60.212 41.99a3.998 3.998 0 0 0 4.576 0l60.212-41.99v71.834c0 5.101-4.172 9.25-9.3 9.25z"></path>
                        </g>
                    </svg>
                    <span style={{ marginLeft: '10px' }}>contact@fryfoundation.com</span>
                </p>


                <div style={{ display: 'flex', justifyContent: 'space-between', width: '150px' }}>
                    <a href="https://twitter.com/your-handle">
                        <svg height="20" width="25" viewBox="0 0 200 200" fill="white">
                            <g>
                                <path xmlns="http://www.w3.org/2000/svg" fill="white" d="M221.95 51.29c.15 2.17.15 4.34.15 6.53 0 66.73-50.8 143.69-143.69 143.69v-.04c-27.44.04-54.31-7.82-77.41-22.64 3.99.48 8 .72 12.02.73 22.74.02 44.83-7.61 62.72-21.66-21.61-.41-40.56-14.5-47.18-35.07 7.57 1.46 15.37 1.16 22.8-.87-23.56-4.76-40.51-25.46-40.51-49.5v-.64c7.02 3.91 14.88 6.08 22.92 6.32C11.58 63.31 4.74 33.79 18.14 10.71c25.64 31.55 63.47 50.73 104.08 52.76-4.07-17.54 1.49-35.92 14.61-48.25 20.34-19.12 52.33-18.14 71.45 2.19 11.31-2.23 22.15-6.38 32.07-12.26-3.77 11.69-11.66 21.62-22.2 27.93 10.01-1.18 19.79-3.86 29-7.95-6.78 10.16-15.32 19.01-25.2 26.16z" />
                            </g>
                        </svg>
                    </a>
                    <a href="https://discord.com/in/your-profile" style={{ marginLeft: '2px' }}>
                        <svg height="25" width="25" viewBox="0 0 200 200" fill="white">
                            <path xmlns="http://www.w3.org/2000/svg" d="M78.864,0c43.556,0,78.863,35.308,78.863,78.864c0,43.552-35.308,78.868-78.863,78.868   C35.308,157.731,0,122.416,0,78.864C0,35.308,35.308,0,78.864,0z" fill="white" />
                            <path xmlns="http://www.w3.org/2000/svg" d="M113.101,53.34c0,0-9.76-7.635-21.284-8.514l-1.043,2.076c10.425,2.552,15.2,6.207,20.199,10.695   c-8.612-4.394-17.112-8.514-31.927-8.514c-14.815,0-23.322,4.12-31.926,8.514c4.985-4.488,10.677-8.545,20.192-10.695l-1.036-2.076   c-12.099,1.145-21.284,8.514-21.284,8.514S34.09,69.143,32.221,100.166c10.985,12.672,27.669,12.771,27.669,12.771l3.487-4.649   c-5.923-2.059-12.61-5.741-18.386-12.378c6.889,5.209,17.293,10.642,34.055,10.642c16.762,0,27.158-5.426,34.055-10.642   c-5.783,6.637-12.47,10.319-18.386,12.378l3.487,4.649c0,0,16.677-0.099,27.669-12.771C123.995,69.143,113.101,53.34,113.101,53.34   z M65.211,91.651c-4.117,0-7.449-3.809-7.449-8.514c0-4.701,3.333-8.513,7.449-8.513c4.117,0,7.45,3.812,7.45,8.513   C72.661,87.843,69.328,91.651,65.211,91.651z M92.881,91.651c-4.117,0-7.45-3.809-7.45-8.514c0-4.701,3.333-8.513,7.45-8.513   c4.116,0,7.449,3.812,7.449,8.513C100.33,87.843,96.99,91.651,92.881,91.651z" fill="black" />
                        </svg>
                    </a>
                    <a href="https://linkedin.com/in/your-profile">
                        <svg xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" fill="white" height="20px" width="20px" version="1.1" id="Layer_1" viewBox="0 0 310 310" xmlSpace="preserve">
                            <g id="XMLID_801_">
                                <path id="XMLID_802_" d="M72.16,99.73H9.927c-2.762,0-5,2.239-5,5v199.928c0,2.762,2.238,5,5,5H72.16c2.762,0,5-2.238,5-5V104.73   C77.16,101.969,74.922,99.73,72.16,99.73z" />
                                <path id="XMLID_803_" d="M41.066,0.341C18.422,0.341,0,18.743,0,41.362C0,63.991,18.422,82.4,41.066,82.4   c22.626,0,41.033-18.41,41.033-41.038C82.1,18.743,63.692,0.341,41.066,0.341z" />
                                <path id="XMLID_804_" d="M230.454,94.761c-24.995,0-43.472,10.745-54.679,22.954V104.73c0-2.761-2.238-5-5-5h-59.599   c-2.762,0-5,2.239-5,5v199.928c0,2.762,2.238,5,5,5h62.097c2.762,0,5-2.238,5-5v-98.918c0-33.333,9.054-46.319,32.29-46.319   c25.306,0,27.317,20.818,27.317,48.034v97.204c0,2.762,2.238,5,5,5H305c2.762,0,5-2.238,5-5V194.995   C310,145.43,300.549,94.761,230.454,94.761z" />
                            </g>
                        </svg>
                    </a>
                    <a href="https://facebook.com/your-profile">

                        <svg xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink" fill="white" height="20px" width="20px" version="1.1" id="Layer_1" x="0px" y="0px" viewBox="73 0 267 266.9" enableBackground="new 73 0 267 266.9" xmlSpace="preserve"><script id="dashlane_tiresias" /><script id="dashlane_webauthn" />

                            <path id="f" fill="white" d="M255.4,262.3v-99.8h33.5l5-38.9h-38.5V98.8c0-11.3,3.1-18.9,19.3-18.9l20.6,0V45  c-3.6-0.5-15.8-1.5-30-1.5c-29.7,0-50,18.1-50,51.4v28.7h-33.6v38.9h33.6v99.8H255.4z" />

                        </svg>

                    </a>
                    <a href="https://youtube.com/c/your-channel">
                        <img
                            alt="Youtube"
                            style={{ width: '20px', height: '20px', objectFit: 'cover' }}
                            src="https://static.wixstatic.com/media/11062b_fe985b889c144b348eefc7bbc67018b4~mv2.png/v1/fill/w_20,h_20,al_c,q_85,usm_0.66_1.00_0.01,enc_auto/11062b_fe985b889c144b348eefc7bbc67018b4~mv2.png"
                        />

                    </a>
                </div>

                <p
                    style={{
                        marginTop: '60px',
                        color: '#595959',
                        fontSize: '12px',
                    }}
                >© Fry Foundation. All Rights Reserved.</p>

            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '20px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', marginRight: '10px', marginLeft: '10px' }}>
                    <h1 style={{ marginBottom: '20px', fontSize: '20px' }} >Quick Links</h1>
                    <p><a href="https://www.fryfoundation.com/">Home</a></p>
                    <p><a href="https://www.fryfoundation.com/about">About Us</a></p>
                    <p><a href="https://www.fryfoundation.com/roadmap">Roadmap</a></p>
                    <p><a href="https://www.fryfoundation.com/shop">Buy $FRY Miners</a></p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', marginRight: '10px', marginLeft: '10px' }}>
                    <h1 style={{ marginBottom: '20px', fontSize: '20px' }} >Resources</h1>
                    <p><a href="https://www.fryfoundation.com/instructions">General Setup Instructions</a></p>
                    <p><a href="https://www.fryfoundation.com/shipping-updates">Shipping Updates</a></p>
                    <p><a href="https://www.fryfoundation.com/recycle-miner-download">Recycle Mining</a></p>
                    <p><a href="https://www.fryfoundation.com/explorer">Explorer</a></p>
                    <p><a href="https://www.fryfoundation.com/news">News</a></p>
                    <p><a href="https://www.fryfoundation.com/faq">FAQ</a></p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', marginRight: '10px', marginLeft: '10px' }}>
                    <h1 style={{ marginBottom: '20px', fontSize: '20px' }} >$FRY Mining</h1>
                    <p><a href="https://www.fryfoundation.com/fry-recycle-mining">$FRY Recycle Mining</a></p>
                    <p><a href="https://www.fryfoundation.com/free-tier-instructions">Free Tier Instructions</a></p>
                    <p><a href="https://www.fryfoundation.com/paid-tier-instructions">Paid Tier Instructions</a></p>
                    <p><a href="https://www.fryfoundation.com/free-tier-registration">Free Tier Registration</a></p>
                    <p><a href="https://www.fryfoundation.com/paid-tier-registration">Paid Tier Registration</a></p>
                    <p><a href="https://www.fryfoundation.com/paid-tier-plans">Paid Tier Plans</a></p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', marginRight: '10px', marginLeft: '10px' }}>
                    <h1 style={{ marginBottom: '20px', fontSize: '20px' }} >Legal</h1>
                    <p><a href="https://www.fryfoundation.com/terms-conditions">Terms & Conditions</a></p>
                    <p><a href="https://www.fryfoundation.com/privacy-policy">Privacy Policy</a></p>
                    <p><a href="https://www.fryfoundation.com/return-policy">Return Policy</a></p>
                    <p><a href="https://www.fryfoundation.com/digital-item-policy">Digital Item Policy</a></p>
                    <p><a href="https://www.fryfoundation.com/warranty-policy">Warranty Policy</a></p>
                </div>
            </div>


        </footer>
    );
}

interface LineProps {
    color: string;
}

const ColoredLine: React.FC<LineProps> = ({ color }) => (
    <div
        style={{
            backgroundColor: color,
            height: '1px',
            width: '80%',
            marginBottom: '40px',
            marginTop: '10px',
            position: 'absolute',
            //center it
            left: '50%',
            transform: 'translate(-50%, -50%)'


        }}
    />
);

