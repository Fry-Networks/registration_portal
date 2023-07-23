import React, { useContext, useEffect, useState } from "react";
import Modal from 'react-modal';
import { processData } from "../server/KeyProcessor";
import { useWallet } from "@txnlab/use-wallet";


export default function RegistrationModal({ isOpen, setOpen }: { isOpen: boolean, setOpen: Function }) {
    const [formData, setFormData] = useState({
        firstName: "",
        lastName: "",
        email: "",
        miner_key: "",
    });
    const [message, setMessage] = useState("");
    const {activeAddress} = useWallet();
    const handleChange = (event: any) => {
        setFormData({
            ...formData,
            [event.target.name]: event.target.value,
        });
    };

    const handleSubmit = async (event: any) => {
        event.preventDefault();
        console.log(formData); // Or do something with the form data
        setMessage("Processing...");
        const nameTests = /^[a-z ,.'-]+$/i.test(formData.firstName) &&
            /^[a-z ,.'-]+$/i.test(formData.lastName) &&
            formData.firstName.length > 0 &&
            formData.lastName.length > 0 &&
            formData.firstName.length < 50 &&
            formData.lastName.length < 50;

        const emailTest = /^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/.test(formData.email);
        const minerKeyTest = /^(VPN|OGPS|IGPS|IDB|ODB)-([a-zA-Z]|[0-9]){32}$/.test(formData.miner_key);

        if (!nameTests) {
            setMessage("Please enter valid names");
            return;
        }

        if (!emailTest) {
            setMessage("Please enter a valid email");
            return;
        }
        if (!minerKeyTest) {
            setMessage("Please enter a valid miner key");
            return;
        }
        
        const res = await processData(formData, activeAddress!);
        setMessage(res);
    };


    return (
        <Modal
            isOpen={isOpen}
            style={{
                overlay: {
                    backgroundColor: 'rgba(0, 0, 0, 0.75)'
                },
                content: {
                    backgroundColor: 'RGB(43, 3, 4)',
                    color: 'white',
                    top: '50%',
                    left: '50%',
                    right: 'auto',
                    bottom: 'auto',
                    marginRight: '-50%',
                    transform: 'translate(-50%, -50%)',
                    display: 'grid',
                }
            }}
        >
            <button style={{
                fontSize: '20px',
                justifySelf: 'flex-end',
                borderRadius: '50%',
                borderColor: 'white',
                borderInlineColor: 'white',
                borderWidth: '1px',  // Add this line
                borderStyle: 'solid',  // Add this line
                boxShadow: 'none',

            }}
                onClick={() => {
                    setOpen(false);
                }}
            >X</button>

            <div style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                width: '700px'
            }}>
                <form action="" style={{
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems: 'center',
                    color: 'black'
                }}>
                    <div style={{
                        display: 'flex',
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                    }}>
                        <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'center',
                            alignItems: 'center',
                            marginRight: '20px'
                        }}>
                            <label htmlFor="firstName" style={{
                                color: 'white'
                            }}>First name</label>
                            <input type="text" id="firstName" name="firstName" placeholder="Philip" onChange={handleChange} />
                        </div>
                        <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'center',
                            alignItems: 'center',
                        }}>
                            <label htmlFor="lastName" style={{
                                color: 'white'
                            }}>Last name</label>
                            <input type="text" id="lastName" name="lastName" placeholder="J. Fry" onChange={handleChange} />
                        </div>
                    </div>
                    <label htmlFor="email" style={{
                        color: 'white',
                        marginTop: '10px'
                    }}>Email</label>
                    <input type="email" id="email" name="email" placeholder="philipfry@futura.ma" onChange={handleChange} />
                    <label htmlFor="miner_key" style={{
                        color: 'white',
                        marginTop: '5px',
                    }}>Miner Key</label>
                    <input type="text" id="miner_key" name="miner_key" placeholder="XXXX-XXXXXXXX" onChange={handleChange} style={{
                        width: '100%'
                    }}/>

                    <button type="submit" onClick={handleSubmit} style={{
                        color: "white",
                        border: "2px solid RGB(226, 28, 34)",
                        marginTop: "15px",
                    }}>Submit</button>
                </form>

                <p>{message}</p>


            </div>

        </Modal>



    )


}